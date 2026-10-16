"""Driver OpenHands SDK untuk evaluasi rakit (scripts/ai-eval/sandbox-engines.mjs).

Protokol: perintah JSON per baris di stdin ({"type": "prompt", "message": ...}); setiap perintah dijalankan sampai
agen berhenti, lalu baris "@@RAKIT {...}" ditulis ke stdout (tool yang dipanggil, error, dan "settled" berisi jawaban
akhir serta token kumulatif). Keluaran lain dari SDK diabaikan host.

Agen: tool bawaan OpenHands (terminal, file_editor, task_tracker) + create_table dengan skema yang sama dengan
Builder (dibaca dari $RAKIT_RUN/create_table.json), dijalankan lewat bridge HTTP di host. Aturan rakit ditambahkan ke
prompt sistem bawaan OpenHands (AgentContext.system_message_suffix), atau — mode AGENTS.md — dimuat dari
/workspace/AGENTS.md sebagai project skill.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence

from pydantic import BaseModel, Field, SecretStr

from openhands.sdk import LLM, Action, Agent, AgentContext, Conversation, Observation, TextContent, Tool, ToolDefinition, load_skills_from_dir
from openhands.sdk.conversation.response_utils import get_agent_final_response
from openhands.sdk.event import ActionEvent, AgentErrorEvent, ObservationEvent
from openhands.sdk.tool import ToolExecutor, register_tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.terminal import TerminalTool

RUN = os.environ["RAKIT_RUN"]
OUT = sys.stdout


def emit(obj):
    OUT.write("@@RAKIT " + json.dumps(obj, default=str) + "\n")
    OUT.flush()


SPEC = json.load(open(f"{RUN}/create_table.json"))
PROPS = SPEC["parameters"]["properties"]
COL = PROPS["columns"]["items"]["properties"]


class Column(BaseModel):
    name: str = Field(description=COL["name"]["description"])
    type: str = Field(description=f'{COL["type"]["description"]} One of: {", ".join(COL["type"]["enum"])}.')
    refTable: str | None = Field(default=None, description=COL["refTable"]["description"])
    required: bool = False
    private: bool = Field(default=False, description=COL["private"]["description"])


class CreateTableAction(Action):
    name: str = Field(description=PROPS["name"]["description"])
    columns: list[Column]
    public: list[str] = Field(description=f'{PROPS["public"]["description"]} Each one of: {", ".join(PROPS["public"]["items"]["enum"])}.')


class CreateTableObservation(Observation):
    pass


class CreateTableExecutor(ToolExecutor[CreateTableAction, CreateTableObservation]):
    def __call__(self, action: CreateTableAction, conversation=None) -> CreateTableObservation:  # noqa: ARG002
        body = json.dumps(action.model_dump(include={"name", "columns", "public"}, exclude_none=True)).encode()
        req = urllib.request.Request(f'{os.environ["RAKIT_BRIDGE"]}/create_table', data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return CreateTableObservation.from_text(res.read().decode())
        except urllib.error.HTTPError as err:
            return CreateTableObservation.from_text(err.read().decode(), is_error=True)


class CreateTableTool(ToolDefinition[CreateTableAction, CreateTableObservation]):
    @classmethod
    def create(cls, conv_state) -> Sequence[ToolDefinition]:  # noqa: ARG003
        return [cls(description=SPEC["description"], action_type=CreateTableAction, observation_type=CreateTableObservation, executor=CreateTableExecutor())]


register_tool("CreateTableTool", CreateTableTool)


def on_event(event):
    if isinstance(event, ActionEvent) and event.source == "agent":
        args = event.action.model_dump(exclude_none=True) if event.action is not None else {}
        emit({"type": "tool", "name": event.tool_name, "args": args, "response": event.llm_response_id})
    elif isinstance(event, ObservationEvent):
        text = "".join(c.text for c in event.observation.content if isinstance(c, TextContent))
        emit({"type": "result", "name": event.tool_name, "error": bool(getattr(event.observation, "is_error", False)), "text": text[:2000]})
    elif isinstance(event, AgentErrorEvent):
        emit({"type": "error", "message": str(event.error)[:500]})


def main():
    llm = LLM(
        usage_id="agent",
        model=os.environ["RAKIT_LLM_MODEL"],
        base_url=os.environ["RAKIT_LLM_BASE_URL"],
        api_key=SecretStr(os.environ["RAKIT_AI_KEY"]),
        max_output_tokens=int(os.environ.get("RAKIT_MAX_TOKENS", "64000")),
    )
    agent = Agent(
        llm=llm,
        tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name), Tool(name=TaskTrackerTool.name), Tool(name="CreateTableTool")],
        # Mode AGENTS.md (RAKIT_AGENTS_MD=1): aturan rakit dimuat OpenHands sendiri dari /workspace/AGENTS.md.
        agent_context=AgentContext(
            # Mode skill (RAKIT_SKILL=1): /opt/skills/rakit/SKILL.md sebagai AgentSkill (dibaca agen saat relevan).
            skills=list(load_skills_from_dir("/opt/skills")[2].values()) if os.environ.get("RAKIT_SKILL") == "1" else [],
            system_message_suffix=open(f"{RUN}/prompt.md").read() or None,
            load_user_skills=False,
            load_public_skills=False,
            load_project_skills=os.environ.get("RAKIT_AGENTS_MD") == "1",
        ),
    )
    conv = Conversation(agent=agent, workspace="/workspace", callbacks=[on_event], max_iteration_per_run=100, visualizer=None)
    for line in sys.stdin:
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cmd.get("type") != "prompt":
            continue
        conv.send_message(cmd["message"])
        try:
            conv.run()
        except Exception as err:  # noqa: BLE001 — dilaporkan ke host, sesi tetap jalan
            emit({"type": "error", "message": f"{type(err).__name__}: {err}"[:500]})
        usage = conv.conversation_stats.get_combined_metrics().accumulated_token_usage
        emit({
            "type": "settled",
            "text": get_agent_final_response(conv.state.events),
            "usage": {
                "prompt": getattr(usage, "prompt_tokens", 0) or 0,
                "completion": getattr(usage, "completion_tokens", 0) or 0,
            },
        })


if __name__ == "__main__":
    main()

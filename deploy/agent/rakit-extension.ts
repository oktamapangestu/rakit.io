// Extension Pi untuk evaluasi: tool create_table dengan skema yang sama persis dengan tool Builder (dibaca dari
// $RAKIT_RUN/create_table.json, ditulis pi-engine.mjs dari toolsJSON). Tabelnya dibuat oleh runner di host
// (bridge HTTP) lewat API database editor, jadi /api/db/<tabel> langsung bisa dicoba dari dalam container.
import fs from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const def = JSON.parse(fs.readFileSync(`${process.env.RAKIT_RUN}/create_table.json`, "utf8"));
	pi.registerTool({
		name: "create_table",
		label: "Create table",
		description: def.description,
		promptSnippet: "Create a database table, or add columns / widen public access on an existing table",
		parameters: Type.Unsafe(def.parameters),
		async execute(_id, params) {
			const res = await fetch(`${process.env.RAKIT_BRIDGE}/create_table`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});
			const text = await res.text();
			if (!res.ok) throw new Error(text);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});
}

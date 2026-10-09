<!-- Tab Diagram (#diagramView): toolbar, panel kode (mode Edit), kanvas, dan Temuan. -->
<script>
  import Toolbar from './Toolbar.svelte';
  import EditPane from './EditPane.svelte';
  import Canvas from './Canvas.svelte';
  import Findings from './Findings.svelte';
  import { diagram } from './state.svelte.js';
</script>

<Toolbar />
<div class="diagram-body">
  {#if diagram.edit}<EditPane />{/if}
  <Canvas />
  <Findings />
</div>

<script>
  import { createEventDispatcher } from "svelte";
  export let points;
  export let won;
  export let playerName;
  export let fontColor;
  const dispatch = createEventDispatcher();

  function plus() {
    dispatch("points", { score: 1, player: playerName.toLowerCase() });
  }

  function minus() {
    dispatch("points", { score: -1, player: playerName.toLowerCase() });
  }
</script>

<style>
  .player {
    flex-grow: 1;
  }
  .plus {
    background-color: seagreen;
  }
  .minus {
    background-color: brown;
  }
  button {
    font-size: 20px;
    border-radius: 3px;
    width: 40px;
    color: white;
    font-family: monospace;
    font-weight: bold;
  }
</style>

<div style="color: {fontColor}" class="player">
  <h2>{points}</h2>
  <button class="plus" on:click={plus}>+</button>
  <button class="minus" on:click={minus}>-</button>
  {#if won}
    <h2>{playerName} Wins</h2>
  {/if}
</div>

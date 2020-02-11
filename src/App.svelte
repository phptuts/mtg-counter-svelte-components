<script>
  import Player from "./Player.svelte";
  let redPlayerPoints = 0;
  let bluePlayerPoints = 0;

  $: blueWon = redPlayerPoints <= 0 && bluePlayerPoints > 0;
  $: redWon = bluePlayerPoints <= 0 && redPlayerPoints > 0;
  $: noGame = bluePlayerPoints == 0 && redPlayerPoints == 0;

  function startGame() {
    redPlayerPoints = 20;
    bluePlayerPoints = 20;
  }

  function updateScore(event) {
    const { player, score } = event.detail;
    if (noGame || redWon || blueWon) {
      return;
    }

    if (player == "red") {
      redPlayerPoints += score;
      return;
    }

    bluePlayerPoints += score;
  }
</script>

<style>
  #container {
    width: 80%;
    padding: 20px;
    border: solid gray 1px;
    margin: 0 auto;
    background-color: wheat;
    margin: 10vh auto;
  }

  #controls-container {
    display: flex;
  }

  button {
    display: block;
    width: 100%;
    margin-top: 20px;
    border: solid salmon 1px;
    background-color: sandybrown;
    color: rgb(61, 56, 56);
    font-size: 20px;
    border-radius: 3px;
  }
</style>

<div id="container">
  <h1>Magic The Gather Game Counter</h1>
  <div id="controls-container">

    <Player
      on:points={updateScore}
      fontColor="red"
      playerName="Red"
      won={redWon}
      points={redPlayerPoints} />
    <Player
      on:points={updateScore}
      fontColor="blue"
      playerName="Blue"
      won={blueWon}
      points={bluePlayerPoints} />
  </div>

  <button on:click={startGame} >Start Game</button>
</div>

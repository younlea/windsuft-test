# Tetris (1P & 2P)

A lightweight browser Tetris with WebAudio sound effects. Supports single-player and local two-player versus with garbage line attacks.

## Demo (Local)
- Start a static server in this folder and open in the browser.
- Example (Python):
  - `python3 -m http.server 5173`
  - Then open http://127.0.0.1:5173

## Features
- 7-bag tetromino randomizer
- Soft drop, hard drop, wall-kick rotation, ghost piece
- Scoring, levels, and line count
- Next piece preview
- WebAudio SFX (move, rotate, drop, lock, line clear, game over)
- 2P versus mode with garbage lines on multi-line clears (clears-1)

## Controls
### Player 1
- Left/Right: Move
- Down: Soft drop
- Up or X: Rotate CW
- Z: Rotate CCW
- Space: Hard drop
- P: Pause/Resume (both players)

### Player 2 (2P mode)
- A/D: Move
- S: Soft drop
- W or K: Rotate CW
- Q: Rotate CCW
- Enter: Hard drop

## UI
- 1P / 2P buttons: choose the mode (2P toggles the second board & UI)
- Start: begin the game (initializes audio)
- Pause: toggle pause
- Restart: reset and start a new game

## How to Run
1. Clone or copy this folder into your repository.
2. Serve it with any static server.
3. Click Start to initialize audio and begin.

## Files
- `index.html` – layout and UI
- `style.css` – styling
- `main.js` – game logic and audio

## Notes
- Audio will only play after a user gesture (click Start), due to browser autoplay policies.
- The versus garbage is simple: clearing 2/3/4 lines sends 1/2/3 garbage lines to the opponent.

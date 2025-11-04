/* Core Tetris with WebAudio SFX, 1P/2P modes */
(function () {
  'use strict';

  // Shared constants
  const COLS = 10;
  const ROWS = 20;
  const COLORS = { I:'#22d3ee', O:'#fde047', T:'#a78bfa', S:'#34d399', Z:'#fb7185', J:'#60a5fa', L:'#f59e0b' };
  const SHAPES = {
    I: [ [[0,1],[1,1],[2,1],[3,1]], [[2,0],[2,1],[2,2],[2,3]], [[0,2],[1,2],[2,2],[3,2]], [[1,0],[1,1],[1,2],[1,3]] ],
    O: [ [[1,1],[2,1],[1,2],[2,2]], [[1,1],[2,1],[1,2],[2,2]], [[1,1],[2,1],[1,2],[2,2]], [[1,1],[2,1],[1,2],[2,2]] ],
    T: [ [[1,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[2,1],[1,2]], [[1,0],[0,1],[1,1],[1,2]] ],
    S: [ [[1,0],[2,0],[0,1],[1,1]], [[1,0],[1,1],[2,1],[2,2]], [[1,1],[2,1],[0,2],[1,2]], [[0,0],[0,1],[1,1],[1,2]] ],
    Z: [ [[0,0],[1,0],[1,1],[2,1]], [[2,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[1,2],[2,2]], [[1,0],[0,1],[1,1],[0,2]] ],
    J: [ [[0,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[1,1],[1,2]], [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[0,2],[1,2]] ],
    L: [ [[2,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]], [[0,1],[1,1],[2,1],[0,2]], [[0,0],[1,0],[1,1],[1,2]] ],
  };

  // UI refs
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');

  // Optional mode buttons (added in HTML in a later step)
  const mode1pBtn = document.getElementById('mode1p');
  const mode2pBtn = document.getElementById('mode2p');
  const content = document.querySelector('.content');

  // Audio (shared)
  let audioReady = false; let ac, master;
  function initAudio() {
    if (audioReady) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.3;
    master.connect(ac.destination);
    audioReady = true;
  }
  function beep(freq = 440, dur = 0.06, type = 'square', vol = 0.2) {
    if (!audioReady) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.01);
  }
  const SFX = {
    click: () => beep(880, 0.05, 'square', 0.15),
    move: () => beep(520, 0.03, 'square', 0.1),
    rotate: () => beep(700, 0.04, 'triangle', 0.12),
    drop: () => beep(300, 0.06, 'sawtooth', 0.15),
    lock: () => beep(260, 0.07, 'square', 0.18),
    lines: (c) => { const base=500; for(let i=0;i<c;i++) setTimeout(()=>beep(base+i*120,0.07,'triangle',0.18), i*40); },
    gameover: () => { const seq=[440,392,349,330,294,262]; seq.forEach((f,i)=> setTimeout(()=>beep(f,0.12,'sine',0.2), i*120)); }
  };

  // Helpers
  function makeBoard() { const b = new Array(ROWS); for (let r=0;r<ROWS;r++) b[r]=new Array(COLS).fill(null); return b; }
  function randBag() { const t=['I','O','T','S','Z','J','L']; for(let i=t.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [t[i],t[j]]=[t[j],t[i]];} return t; }

  class Game {
    constructor(opts) {
      this.id = opts.id;
      this.boardCanvas = opts.boardCanvas;
      this.nextCanvas = opts.nextCanvas;
      this.scoreEl = opts.scoreEl;
      this.levelEl = opts.levelEl;
      this.linesEl = opts.linesEl;
      this.onLinesCleared = opts.onLinesCleared || (()=>{});
      this.onGameOver = opts.onGameOver || (()=>{});

      this.ctx = this.boardCanvas.getContext('2d');
      this.nctx = this.nextCanvas.getContext('2d');
      this.CELL = Math.floor(this.boardCanvas.width / COLS);
      this.BOARD_W = COLS * this.CELL;
      this.BOARD_H = ROWS * this.CELL;

      // State
      this.board = makeBoard();
      this.bag = [];
      this.current = null;
      this.nextType = null;
      this.dropTimer = 0;
      this.dropInterval = 1000;
      this.score = 0; this.level = 1; this.lines = 0;
      this.running = false; this.paused = false; this.gameOver = false;
      this.lastTime = 0;

      // Input
      this.leftHeld=false; this.rightHeld=false; this.downHeld=false;
      this.moveRepeatTimer=0; this.MOVE_REPEAT_DELAY=140; this.MOVE_REPEAT_RATE=40;

      // Prepare
      this.updateSpeed();
      this.updateUI();
      this.resetPieces();
      this.drawBoard();
      this.drawNext();
    }

    resetState() {
      this.board = makeBoard();
      this.bag = [];
      this.current = null; this.nextType = null;
      this.dropTimer = 0; this.score=0; this.level=1; this.lines=0;
      this.updateSpeed(); this.updateUI();
      this.resetPieces();
      this.drawBoard(); this.drawNext();
    }

    resetPieces() {
      this.bag = randBag();
      this.nextType = this.bag.shift();
      if (this.bag.length===0) this.bag = randBag();
      this.spawn();
    }

    spawn() {
      // Proper 7-bag: use nextType as current, then refill nextType from bag
      const type = this.nextType ?? (this.bag.length?this.bag.shift():(this.bag=randBag(), this.bag.shift()));
      if (this.bag.length===0) this.bag = randBag();
      this.nextType = this.bag.shift();
      this.current = { type, x: 3, y: 0, r: 0 };
      if (!this.valid(this.current, 0, 0, this.current.r)) {
        this.current.y = -1;
        if (!this.valid(this.current, 0, 0, this.current.r)) {
          this.gameOver = true; this.running = false; SFX.gameover();
          this.onGameOver(this);
        }
      }
      this.drawNext();
    }

    shapeCells(p) { const cells = SHAPES[p.type][p.r]; return cells.map(([cx,cy])=>({x:p.x+cx, y:p.y+cy})); }

    valid(p, dx, dy, r) {
      const cells = SHAPES[p.type][r].map(([cx,cy])=>({x:p.x+cx+dx, y:p.y+cy+dy}));
      for (const c of cells) {
        if (c.x<0||c.x>=COLS||c.y>=ROWS) return false;
        if (c.y>=0 && this.board[c.y][c.x]) return false;
      }
      return true;
    }

    rotate(dir) {
      const r = (this.current.r + dir + 4) % 4;
      const kicks = [[0,0],[1,0],[-1,0],[0,-1],[0,1],[2,0],[-2,0]];
      for (const [kx,ky] of kicks) {
        if (this.valid(this.current, kx, ky, r)) {
          this.current.x += kx; this.current.y += ky; this.current.r = r; SFX.rotate(); return true;
        }
      }
      return false;
    }

    hardDrop() {
      let dist=0; while (this.valid(this.current,0,1,this.current.r)) { this.current.y++; dist++; }
      if (dist>0) SFX.drop(); this.lock();
    }

    lock() {
      for (const c of this.shapeCells(this.current)) {
        if (c.y>=0&&c.y<ROWS&&c.x>=0&&c.x<COLS) this.board[c.y][c.x]=this.current.type;
      }
      SFX.lock();
      const cleared = this.clearLines();
      if (cleared>0) {
        const add = [0,100,300,500,800][cleared]*this.level; this.score += add; this.lines += cleared; SFX.lines(cleared);
        const newLevel = Math.floor(this.lines/10)+1; if (newLevel!==this.level){ this.level=newLevel; this.updateSpeed(); }
        this.updateUI();
        // Versus: send garbage (cleared-1)
        const garbage = Math.max(0, cleared-1);
        if (garbage>0) this.onLinesCleared(this, garbage);
      }
      this.spawn();
    }

    clearLines() {
      let count=0;
      for (let r=ROWS-1;r>=0;r--) {
        if (this.board[r].every(v=>v)) {
          this.board.splice(r,1);
          this.board.unshift(new Array(COLS).fill(null));
          count++; r++;
        }
      }
      if (count>0) this.score += 40*count*this.level;
      return count;
    }

    addGarbage(n) {
      if (n<=0) return;
      for (let i=0;i<n;i++) {
        const hole = Math.floor(Math.random()*COLS);
        const row = new Array(COLS).fill('X'); // use 'X' as garbage color key
        row[hole] = null;
        this.board.shift();
        this.board.push(row);
      }
    }

    updateSpeed() { this.dropInterval = Math.max(80, 1000 - (this.level-1)*80); }

    drawCell(ctx,x,y,color,cell) {
      const px=x*cell, py=y*cell; ctx.fillStyle=color; ctx.fillRect(px,py,cell,cell);
      ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(px,py,cell,3); ctx.fillRect(px,py,3,cell);
      ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(px,py+cell-3,cell,3); ctx.fillRect(px+cell-3,py,3,cell);
    }

    drawBoard() {
      const ctx=this.ctx; const CELL=this.CELL; const BW=this.BOARD_W; const BH=this.BOARD_H;
      ctx.clearRect(0,0,BW,BH);
      ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
      for (let x=0;x<=COLS;x++){ ctx.beginPath(); ctx.moveTo(x*CELL+0.5,0); ctx.lineTo(x*CELL+0.5,BH); ctx.stroke(); }
      for (let y=0;y<=ROWS;y++){ ctx.beginPath(); ctx.moveTo(0,y*CELL+0.5); ctx.lineTo(BW,y*CELL+0.5); ctx.stroke(); }

      // ghost
      if (this.current) {
        const ghost={...this.current}; while (this.valid(ghost,0,1,ghost.r)) ghost.y++;
        ctx.globalAlpha=0.25; for (const c of this.shapeCells(ghost)) if (c.y>=0) this.drawCell(ctx,c.x,c.y,COLORS[this.current.type],CELL); ctx.globalAlpha=1;
      }

      // locked
      for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) { const t=this.board[y][x]; if (t) this.drawCell(ctx,x,y, t==='X'?'#6b7280':COLORS[t], CELL); }
      // current
      if (this.current) for (const c of this.shapeCells(this.current)) if (c.y>=0) this.drawCell(ctx,c.x,c.y,COLORS[this.current.type],CELL);
    }

    drawNext() {
      const nctx=this.nctx; const w=this.nextCanvas.width, h=this.nextCanvas.height; nctx.clearRect(0,0,w,h);
      const size=4; const cell=Math.floor(Math.min(w,h)/size); const ox=Math.floor((w-size*cell)/2); const oy=Math.floor((h-size*cell)/2);
      nctx.fillStyle='#0b1226'; nctx.fillRect(0,0,w,h);
      const cells = SHAPES[this.nextType][0];
      for (const [cx,cy] of cells) {
        const px=ox+cx*cell, py=oy+cy*cell; nctx.fillStyle=COLORS[this.nextType]; nctx.fillRect(px,py,cell,cell);
        nctx.fillStyle='rgba(255,255,255,0.08)'; nctx.fillRect(px,py,cell,3); nctx.fillRect(px,py,3,cell);
        nctx.fillStyle='rgba(0,0,0,0.25)'; nctx.fillRect(px,py+cell-3,cell,3); nctx.fillRect(px+cell-3,py,3,cell);
      }
    }

    updateUI() { this.scoreEl.textContent=String(this.score); this.levelEl.textContent=String(this.level); this.linesEl.textContent=String(this.lines); }

    tick(dt) {
      if (!this.running || this.paused || this.gameOver) return;
      // movement repeat
      this.moveRepeatTimer += dt;
      if (this.leftHeld || this.rightHeld) {
        if (this.moveRepeatTimer > this.MOVE_REPEAT_DELAY) {
          const step = Math.floor((this.moveRepeatTimer - this.MOVE_REPEAT_DELAY)/this.MOVE_REPEAT_RATE);
          if (step>0) {
            const dx = this.leftHeld?-1:1; for (let i=0;i<step;i++) if (this.valid(this.current,dx,0,this.current.r)) this.current.x += dx;
            this.moveRepeatTimer = this.MOVE_REPEAT_DELAY + ((this.moveRepeatTimer - this.MOVE_REPEAT_DELAY) % this.MOVE_REPEAT_RATE);
          }
        }
      }
      // gravity
      this.dropTimer += dt; const soft = this.downHeld? Math.max(50, this.dropInterval*0.18) : this.dropInterval;
      if (this.dropTimer > soft) {
        if (this.valid(this.current,0,1,this.current.r)) this.current.y += 1; else this.lock();
        this.dropTimer = 0;
      }
      this.drawBoard();
    }

    // Input API for external keymap
    pressLeft() { if (!this.running||this.paused) return; if (this.valid(this.current,-1,0,this.current.r)) { this.current.x--; SFX.move(); } this.leftHeld=true; this.moveRepeatTimer=0; }
    releaseLeft() { this.leftHeld=false; }
    pressRight() { if (!this.running||this.paused) return; if (this.valid(this.current,1,0,this.current.r)) { this.current.x++; SFX.move(); } this.rightHeld=true; this.moveRepeatTimer=0; }
    releaseRight() { this.rightHeld=false; }
    pressDown() { if (!this.running||this.paused) return; if (this.valid(this.current,0,1,this.current.r)) { this.current.y++; SFX.move(); } this.downHeld=true; }
    releaseDown() { this.downHeld=false; }
    rotateCW() { if (!this.running||this.paused) return; this.rotate(1); }
    rotateCCW() { if (!this.running||this.paused) return; this.rotate(-1); }
    hardDrop() { if (!this.running||this.paused) return; this.hardDrop(); }
    togglePause() { if (!this.running) return; this.paused=!this.paused; }

    start() { this.running=true; this.paused=false; this.gameOver=false; }
    restart() { this.resetState(); this.start(); }
  }

  // Two-player wiring
  let game1, game2; let lastTime=0; let globalRunning=false;
  function ensureCanvasesForPlayer(id) {
    const board = document.getElementById(id==='p1'?'board':'board2');
    const next = document.getElementById(id==='p1'?'next':'next2');
    const score = document.getElementById(id==='p1'?'score':'score2');
    const level = document.getElementById(id==='p1'?'level':'level2');
    const lines = document.getElementById(id==='p1'?'lines':'lines2');
    return { board, next, score, level, lines };
  }

  function createGames(mode2p=false) {
    const p1 = ensureCanvasesForPlayer('p1');
    const p2 = ensureCanvasesForPlayer('p2');
    // normalize canvas sizes
    if (p1.board) { p1.board.width=300; p1.board.height=600; }
    if (p2.board) { p2.board.width=300; p2.board.height=600; }

    game1 = new Game({ id:'p1', boardCanvas:p1.board, nextCanvas:p1.next, scoreEl:p1.score, levelEl:p1.level, linesEl:p1.lines,
      onLinesCleared: (self, n)=> { if (mode2p && game2 && !game2.gameOver) game2.addGarbage(n); },
      onGameOver: (self)=>{ if (mode2p) SFX.gameover(); }
    });
    if (mode2p) {
      game2 = new Game({ id:'p2', boardCanvas:p2.board, nextCanvas:p2.next, scoreEl:p2.score, levelEl:p2.level, linesEl:p2.lines,
        onLinesCleared: (self, n)=> { if (game1 && !game1.gameOver) game1.addGarbage(n); },
        onGameOver: (self)=>{ SFX.gameover(); }
      });
    } else {
      game2 = null;
    }
  }

  function startMode(mode2p=false) {
    if (!audioReady) initAudio();
    createGames(mode2p);
    if (mode2p) content?.classList.add('two'); else content?.classList.remove('two');
    game1.start(); if (game2) game2.start();
    hideOverlay(); SFX.click();
    globalRunning = true; lastTime = performance.now(); requestAnimationFrame(loop);
  }

  function loop(ts=0) {
    if (!globalRunning) return requestAnimationFrame(loop);
    const dt = ts - lastTime; lastTime = ts;
    if (game1) game1.tick(dt);
    if (game2) game2.tick(dt);
    requestAnimationFrame(loop);
  }

  // Input: map keys to players
  const keyState = new Set();
  window.addEventListener('keydown', (e)=>{
    if (keyState.has(e.code)) return; // avoid repeats
    keyState.add(e.code);
    // Global controls
    if (e.key==='p' || e.key==='P') { if (game1) game1.togglePause(); if (game2) game2.togglePause(); return; }
    // P1
    if (game1) {
      switch (e.key) {
        case 'ArrowLeft': game1.pressLeft(); break;
        case 'ArrowRight': game1.pressRight(); break;
        case 'ArrowDown': game1.pressDown(); break;
        case 'ArrowUp': case 'x': case 'X': game1.rotateCW(); break;
        case 'z': case 'Z': game1.rotateCCW(); break;
        case ' ': game1.hardDrop(); break;
      }
    }
    // P2 (WASD + Q/E + Enter for hard drop)
    if (game2) {
      switch (e.key) {
        case 'a': case 'A': game2.pressLeft(); break;
        case 'd': case 'D': game2.pressRight(); break;
        case 's': case 'S': game2.pressDown(); break;
        case 'w': case 'W': case 'k': case 'K': game2.rotateCW(); break;
        case 'q': case 'Q': game2.rotateCCW(); break;
        case 'Enter': game2.hardDrop(); break;
      }
    }
  });
  window.addEventListener('keyup', (e)=>{
    keyState.delete(e.code);
    if (game1) {
      if (e.key==='ArrowLeft') game1.releaseLeft();
      if (e.key==='ArrowRight') game1.releaseRight();
      if (e.key==='ArrowDown') game1.releaseDown();
    }
    if (game2) {
      if (e.key==='a' || e.key==='A') game2.releaseLeft();
      if (e.key==='d' || e.key==='D') game2.releaseRight();
      if (e.key==='s' || e.key==='S') game2.releaseDown();
    }
  });

  // UI overlay helpers
  function showOverlay(message) { overlay.classList.remove('hidden'); overlay.querySelector('h2').textContent = message; }
  function hideOverlay() { overlay.classList.add('hidden'); }

  // Buttons
  startBtn.addEventListener('click', ()=>{ startMode(content?.classList.contains('two')); });
  pauseBtn.addEventListener('click', ()=>{ game1?.togglePause(); game2?.togglePause(); SFX.click(); });
  restartBtn.addEventListener('click', ()=>{ if (!audioReady) initAudio(); if (!game1) return; const mode2p = content?.classList.contains('two'); createGames(mode2p); game1.start(); if (game2) game2.start(); SFX.click(); hideOverlay(); });
  mode1pBtn?.addEventListener('click', ()=>{ content?.classList.remove('two'); SFX.click(); });
  mode2pBtn?.addEventListener('click', ()=>{ content?.classList.add('two'); SFX.click(); });

  // Init: prime single-player canvases and message
  const boardCanvas = document.getElementById('board');
  if (boardCanvas) { boardCanvas.width = 300; boardCanvas.height = 600; }
  const board2Canvas = document.getElementById('board2');
  if (board2Canvas) { board2Canvas.width = 300; board2Canvas.height = 600; }
  showOverlay('시작하려면 Start 버튼을 누르세요');
})();

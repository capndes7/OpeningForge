// ══════════════════════════════════════════════════════════════
// PLAY VS BOT MODE — fully self-contained, does not touch OPENINGS,
// the Learn/Test state (S), or any of the opening-trainer logic above.
// ══════════════════════════════════════════════════════════════
const BOT_LEVELS = [
  {skill:0,  elo:'400–600 ELO',    label:'Absolute Beginner', blunder:0.65, time:300},
  {skill:0,  elo:'800–1000 ELO',   label:'Beginner',          blunder:0.22, time:450},
  {skill:2,  elo:'1000–1100 ELO',  label:'Casual Player',     blunder:0.10, time:600},
  {skill:4,  elo:'1100–1300 ELO',  label:'Club Novice',       blunder:0.04, time:800},
  {skill:6,  elo:'1300–1500 ELO',  label:'Club Player',       blunder:0,    time:1000},
  {skill:9,  elo:'1500–1700 ELO',  label:'Strong Club Player',blunder:0,    time:1300},
  {skill:12, elo:'1700–1900 ELO',  label:'Expert',            blunder:0,    time:1700},
  {skill:15, elo:'1900–2100 ELO',  label:'Master',            blunder:0,    time:2200},
  {skill:18, elo:'2100–2400 ELO',  label:'International Master', blunder:0, time:2800},
  {skill:20, elo:'2800+ ELO',      label:'Grandmaster (full strength)', blunder:0, time:3500}
];

let Bot = {
  chess:null, worker:null, workerReady:false, workerError:false,
  level:4, playerColor:'white', flipped:false, gameOver:false, thinking:false,
  selectedSq:null, legalMoves:[], moveList:[], started:false, pendingEval:null,
  capturedByPlayer:[], capturedByBot:[]
};
let BD = {};

function loadBotMode() {
  mainArea.innerHTML = '';
  const tpl = document.getElementById('botTpl');
  mainArea.appendChild(tpl.content.cloneNode(true));
  initBotDom();

  Bot.chess = new Chess(); Bot.gameOver = false; Bot.thinking = false;
  Bot.selectedSq = null; Bot.legalMoves = []; Bot.moveList = []; Bot.started = false; Bot.pendingEval = null; Bot.capturedByPlayer = []; Bot.capturedByBot = [];
  Bot.flipped = Bot.playerColor === 'black';

  BOT_LEVELS.forEach((lv, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${i+1} — ${lv.label} (${lv.elo})`;
    BD.botLevelSelect.appendChild(o);
  });
  BD.botLevelSelect.value = Bot.level;
  BD.botColorSelect.value = Bot.playerColor;

  buildBotCoords();
  renderBotBoard();
  renderCapturedRows();
  BD.botStatusText.textContent = 'Pick a difficulty and a color, then start the game.';
  BD.botResignBtn.style.display = 'none';
  BD.botStartBtn.textContent = 'Start Game';
}

function initBotDom() {
  BD = {};
  ['rankLabels','fileLabels','feedbackBar','autoLabel','btnFlip','btnMute',
   'botTitle','botStatusText','botLevelSelect','botColorSelect','botStartBtn','botResignBtn','botMoveFeed',
   'capturedByBotIcons','capturedByPlayerIcons','capturedDiff','movesToggleBtn','movesToggleArrow','botChatLog',
   'gameOverOverlay','gameOverIcon','gameOverTitle','gameOverSub','gameOverDismiss'].forEach(id => {
    BD[id] = document.getElementById(id);
  });
  BD.btnFlip.addEventListener('click', () => { Bot.flipped = !Bot.flipped; buildBotCoords(); renderBotBoard(); });
  BD.btnMute.addEventListener('click', () => {
    S.muted = !S.muted;
    BD.btnMute.textContent = S.muted ? '🔇' : '🔊';
  });
  BD.btnMute.textContent = S.muted ? '🔇' : '🔊';
  BD.botLevelSelect.addEventListener('change', () => { Bot.level = parseInt(BD.botLevelSelect.value,10); });
  BD.botColorSelect.addEventListener('change', () => { Bot.playerColor = BD.botColorSelect.value; });
  BD.botStartBtn.addEventListener('click', startBotGame);
  BD.botResignBtn.addEventListener('click', resignBotGame);
  BD.movesToggleBtn.addEventListener('click', () => {
    const collapsed = BD.botMoveFeed.classList.toggle('collapsed');
    BD.movesToggleBtn.firstChild.textContent = collapsed ? 'Show Moves ' : 'Hide Moves ';
    BD.movesToggleArrow.textContent = collapsed ? '▾' : '▴';
  });
  BD.gameOverDismiss.addEventListener('click', () => {
    BD.gameOverOverlay.classList.remove('show');
  });
}

// Shows the win/loss/draw overlay on the board and logs the result to chat.
function showGameOverOverlay(outcome, title, sub) {
  BD.gameOverOverlay.className = 'game-over-overlay show ' + outcome; // win | loss | draw
  BD.gameOverIcon.textContent = outcome === 'win' ? '🏆' : outcome === 'loss' ? '💀' : '🤝';
  BD.gameOverTitle.textContent = title;
  BD.gameOverSub.textContent = sub;
  addChatMessage(title + ' ' + sub, outcome === 'win' ? 'brilliant' : outcome === 'loss' ? 'blunder' : 'inaccuracy');
}

function resignBotGame() {
  if (!Bot.started || Bot.gameOver) return;
  Bot.gameOver = true;
  Bot.thinking = false;
  BD.autoLabel.textContent = '';
  const opponent = Bot.playerColor === 'white' ? 'Black' : 'White';
  BD.botStatusText.textContent = `You resigned. ${opponent} wins.`;
  showGameOverOverlay('loss', 'You Resigned', `${opponent} wins.`);
  BD.botResignBtn.style.display = 'none';
  renderBotBoard();
}

function buildBotCoords() {
  const files = Bot.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = Bot.flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  BD.rankLabels.innerHTML = ranks.map(r => `<div class="coord-label">${r}</div>`).join('');
  BD.fileLabels.innerHTML = files.map(f => `<div class="coord-label">${f}</div>`).join('');
}

// ── ENGINE (Stockfish, run via a Web Worker built from a same-origin Blob).
// IMPORTANT: Worker() cannot load a script from a different origin in ANY
// browser — that's a hard spec restriction, not an environment quirk. So we
// fetch the engine script ourselves and hand the Worker a blob: URL, which
// counts as same-origin. This is the standard, correct workaround. ──
const STOCKFISH_CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  'https://unpkg.com/stockfish.js@10.0.2/stockfish.js'
];

function ensureWorker() {
  return new Promise((resolve, reject) => {
    if (Bot.workerReady) { resolve(); return; }
    if (Bot.workerError) { reject(new Error(Bot.workerErrorMsg || 'engine unavailable')); return; }

    (async () => {
      let scriptText = null;
      for (const url of STOCKFISH_CDN_URLS) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          scriptText = await resp.text();
          break;
        } catch (err) { /* try next CDN */ }
      }
      if (!scriptText) {
        Bot.workerError = true;
        Bot.workerErrorMsg = 'Could not download the chess engine. Check your internet connection, or an extension/firewall may be blocking cdnjs.cloudflare.com and unpkg.com.';
        reject(new Error(Bot.workerErrorMsg));
        return;
      }

      let w;
      try {
        const blobUrl = URL.createObjectURL(new Blob([scriptText], {type:'application/javascript'}));
        w = new Worker(blobUrl);
      } catch (err) {
        Bot.workerError = true;
        Bot.workerErrorMsg = 'Your browser blocked the chess engine from starting.';
        reject(new Error(Bot.workerErrorMsg));
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true; w.terminate();
          Bot.workerError = true;
          Bot.workerErrorMsg = 'The chess engine did not respond in time.';
          reject(new Error(Bot.workerErrorMsg));
        }
      }, 10000);

      const onMsg = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'uciok') { w.postMessage('isready'); }
        if (line === 'readyok' && !settled) {
          settled = true; clearTimeout(timeout);
          Bot.worker = w; Bot.workerReady = true;
          w.removeEventListener('message', onMsg);
          resolve();
        }
      };
      w.addEventListener('message', onMsg);
      w.onerror = () => {
        if (!settled) {
          settled = true; clearTimeout(timeout); w.terminate();
          Bot.workerError = true;
          Bot.workerErrorMsg = 'The chess engine crashed while starting.';
          reject(new Error(Bot.workerErrorMsg));
        }
      };
      w.postMessage('uci');
    })();
  });
}

function getEngineMove(fen, level) {
  const lv = BOT_LEVELS[level];
  return new Promise((resolve, reject) => {
    ensureWorker().then(() => {
      const w = Bot.worker;
      const onMsg = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.startsWith('bestmove')) {
          w.removeEventListener('message', onMsg);
          resolve(line.split(' ')[1]);
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage('setoption name Skill Level value ' + lv.skill);
      w.postMessage('position fen ' + fen);
      w.postMessage('go movetime ' + lv.time);
    }).catch(reject);
  });
}

function getEval(fen, movetime) {
  return new Promise((resolve, reject) => {
    ensureWorker().then(() => {
      const w = Bot.worker;
      let lastScore = null; // {cp} or {mate}
      const onMsg = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.startsWith('info') && line.includes(' score ')) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          if (mateMatch) lastScore = {mate: parseInt(mateMatch[1], 10)};
          else if (cpMatch) lastScore = {cp: parseInt(cpMatch[1], 10)};
        }
        if (line.startsWith('bestmove')) {
          w.removeEventListener('message', onMsg);
          resolve(lastScore);
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage('position fen ' + fen);
      w.postMessage('go movetime ' + movetime);
    }).catch(reject);
  });
}

// Converts a {cp} or {mate} score (from the side-to-move's perspective) into
// a single comparable centipawn number, from the given color's perspective.
function scoreToCp(score, sideToMove, forColor) {
  if (!score) return 0;
  let cp = score.mate !== undefined ? (score.mate > 0 ? 100000 - score.mate*100 : -100000 - score.mate*100) : score.cp;
  if (sideToMove !== forColor) cp = -cp;
  return cp;
}

const COMMENTARY = {
  brilliant: ["Brilliant!", "What a shot!", "That's a killer move!", "Outstanding find!", "Incredible — top engine choice!"],
  good:      ["Good move.", "Solid choice.", "Nice, keeps the pressure on.", "That's the right idea.", "Well played."],
  inaccuracy:["Slight inaccuracy.", "There was something sharper.", "A bit imprecise.", "Not the most accurate move."],
  mistake:   ["That's a mistake.", "Ouch, that gives something back.", "Not ideal — watch out.", "That loosens your position."],
  blunder:   ["That's a blunder!", "Yikes, that hangs material.", "Big mistake — the bot will punish that.", "That's going to hurt."]
};
function pickPhrase(category) {
  const list = COMMENTARY[category];
  return list[Math.floor(Math.random() * list.length)];
}
function classifyDelta(delta, level) {
  // Lower difficulty levels get a forgiving bonus — commentary shouldn't grade
  // a casual/lower-level game as strictly as it would grade a master-level one.
  const leniencyByLevel = [70, 55, 45, 35, 25, 15, 10, 5, 0, 0];
  const bonus = leniencyByLevel[level] || 0;
  const d = delta + bonus;
  if (d >= 60)   return 'brilliant';
  if (d >= -30)  return 'good';
  if (d >= -90)  return 'inaccuracy';
  if (d >= -220) return 'mistake';
  return 'blunder';
}

function addChatMessage(text, category) {
  if (!BD.botChatLog) return;
  const el = document.createElement('div');
  el.className = 'chat-msg ' + (category || '');
  el.textContent = text;
  BD.botChatLog.appendChild(el);
  BD.botChatLog.scrollTop = BD.botChatLog.scrollHeight;
}

function uciToMove(uci, chess) {
  const from = uci.slice(0,2), to = uci.slice(2,4);
  const promo = uci.length > 4 ? uci[4] : 'q';
  return chess.move({from, to, promotion: promo});
}

// ── GAME FLOW ──
function startBotGame() {
  Bot.chess = new Chess(); Bot.gameOver = false; Bot.thinking = false;
  Bot.selectedSq = null; Bot.legalMoves = []; Bot.moveList = []; Bot.started = true; Bot.pendingEval = null; Bot.capturedByPlayer = []; Bot.capturedByBot = [];
  Bot.flipped = Bot.playerColor === 'black';
  buildBotCoords();
  BD.botMoveFeed.innerHTML = '';
  BD.botMoveFeed.classList.add('collapsed');
  BD.movesToggleBtn.firstChild.textContent = 'Show Moves ';
  BD.movesToggleArrow.textContent = '▾';
  BD.botChatLog.innerHTML = '';
  BD.gameOverOverlay.classList.remove('show');
  BD.botTitle.textContent = `Level ${Bot.level+1} — ${BOT_LEVELS[Bot.level].label}`;
  BD.botStatusText.textContent = `Playing as ${Bot.playerColor === 'white' ? 'White' : 'Black'}.`;
  addChatMessage(`New game started — Level ${Bot.level+1} (${BOT_LEVELS[Bot.level].label}). You're playing ${Bot.playerColor === 'white' ? 'White' : 'Black'}.`, 'good');
  BD.autoLabel.textContent = '';
  BD.botResignBtn.style.display = 'block';
  BD.botStartBtn.textContent = 'Restart Game';
  renderBotBoard();
  renderCapturedRows();
  if (Bot.playerColor === 'black') triggerBotMove();
  else prefetchEval();
}

function prefetchEval() {
  if (Bot.gameOver) return;
  const fen = Bot.chess.fen();
  Bot.pendingEval = {fen, promise: getEval(fen, 500).catch(() => null)};
}

const PIECE_VALUES = {p:1, n:3, b:3, r:5, q:9};

function recordCapture(result) {
  if (!result.captured) return;
  const playerLetter = Bot.playerColor === 'white' ? 'w' : 'b';
  // result.color is the mover's color; the captured piece belonged to the other side.
  if (result.color === playerLetter) Bot.capturedByPlayer.push(result.captured);
  else Bot.capturedByBot.push(result.captured);
}

function renderCapturedRows() {
  if (!BD.capturedByBotIcons) return;
  const sortDesc = (a, b) => PIECE_VALUES[b] - PIECE_VALUES[a];
  const playerVal = Bot.capturedByPlayer.reduce((s, p) => s + PIECE_VALUES[p], 0);
  const botVal = Bot.capturedByBot.reduce((s, p) => s + PIECE_VALUES[p], 0);
  const diff = playerVal - botVal;
  const playerLetter = Bot.playerColor === 'white' ? 'w' : 'b';
  const botLetter = playerLetter === 'w' ? 'b' : 'w';

  const iconsHtml = (types, color) => [...types].sort(sortDesc)
    .map(t => `<img src="${PIECE_IMGS[color + t.toUpperCase()]}" alt="${t}">`).join('');

  // "Bot captured" = pieces the bot took from the player (shown as player-colored icons).
  BD.capturedByBotIcons.innerHTML = iconsHtml(Bot.capturedByBot, playerLetter);
  // "You captured" = pieces the player took from the bot (shown as bot-colored icons).
  BD.capturedByPlayerIcons.innerHTML = iconsHtml(Bot.capturedByPlayer, botLetter);

  if (diff === 0) BD.capturedDiff.textContent = '';
  else BD.capturedDiff.textContent = diff > 0 ? `You're up +${diff}` : `Bot is up +${-diff}`;
}

function botGameOverCheck() {
  if (Bot.chess.in_checkmate()) {
    const winnerColor = Bot.chess.turn() === 'w' ? 'black' : 'white'; // side that just moved won
    const winnerLabel = winnerColor === 'white' ? 'White' : 'Black';
    const outcome = winnerColor === Bot.playerColor ? 'win' : 'loss';
    Bot.gameOver = true;
    BD.botStatusText.textContent = `Checkmate — ${winnerLabel} wins.`;
    showGameOverOverlay(outcome, outcome === 'win' ? 'Checkmate — You Win!' : 'Checkmate', `${winnerLabel} wins.`);
    BD.botResignBtn.style.display = 'none';
    return true;
  }
  if (Bot.chess.in_stalemate()) {
    Bot.gameOver = true;
    BD.botStatusText.textContent = 'Draw by stalemate.';
    showGameOverOverlay('draw', 'Stalemate', 'The game is a draw.');
    BD.botResignBtn.style.display = 'none';
    return true;
  }
  if (Bot.chess.in_draw()) {
    Bot.gameOver = true;
    BD.botStatusText.textContent = 'Draw.';
    showGameOverOverlay('draw', 'Draw', 'Neither side could force a win.');
    BD.botResignBtn.style.display = 'none';
    return true;
  }
  return false;
}

function addBotMoveToFeed(san, color) {
  Bot.moveList.push({san, color});
  const i = Bot.moveList.length - 1;
  const entry = document.createElement('div');
  entry.className = 'move-entry active';
  entry.innerHTML = `<div class="move-number">${color==='w'?Math.floor(i/2)+1+'.':''}</div>
    <div class="move-info"><div class="move-san">${san}<span class="who-badge ${color==='w'?'w':'b'}">${color==='w'?'White':'Black'}</span></div></div>`;
  document.querySelectorAll('#botMoveFeed .move-entry').forEach(el => el.classList.remove('active'));
  BD.botMoveFeed.appendChild(entry);
  entry.scrollIntoView({block:'nearest', behavior:'smooth'});
}

function triggerBotMove() {
  if (Bot.gameOver) return;
  Bot.thinking = true;
  BD.autoLabel.textContent = 'Bot is thinking…';
  renderBotBoard();
  const fen = Bot.chess.fen();
  const lv = BOT_LEVELS[Bot.level];

  getEngineMove(fen, Bot.level).then(uci => {
    let result;
    if (lv.blunder > 0 && Math.random() < lv.blunder) {
      const legal = Bot.chess.moves({verbose:true});
      const pick = legal[Math.floor(Math.random() * legal.length)];
      result = Bot.chess.move({from:pick.from, to:pick.to, promotion:'q'});
    } else {
      result = uciToMove(uci, Bot.chess);
      if (!result) { // fallback if engine returns something unparseable
        const legal = Bot.chess.moves({verbose:true});
        const pick = legal[Math.floor(Math.random() * legal.length)];
        result = Bot.chess.move({from:pick.from, to:pick.to, promotion:'q'});
      }
    }
    if (result.captured) sndCapture(); else sndMove();
    recordCapture(result);
    renderCapturedRows();
    addBotMoveToFeed(result.san, result.color);
    Bot.thinking = false;
    BD.autoLabel.textContent = '';
    renderBotBoard();
    if (!botGameOverCheck()) {
      BD.botStatusText.textContent = 'Your move.';
      prefetchEval();
    }
  }).catch((err) => {
    Bot.thinking = false;
    BD.autoLabel.textContent = '';
    const msg = (err && err.message) ? err.message : "Couldn't reach the chess engine — check your network settings and try again.";
    BD.botStatusText.textContent = msg;
    addChatMessage(msg, 'blunder');
    renderBotBoard();
  });
}

function attemptBotMove(from, to) {
  const piece = Bot.chess.get(from);
  const fenBefore = Bot.chess.fen();
  const sideBefore = Bot.chess.turn();
  const evalBeforePromise = (Bot.pendingEval && Bot.pendingEval.fen === fenBefore)
    ? Bot.pendingEval.promise
    : getEval(fenBefore, 500).catch(() => null);
  Bot.pendingEval = null;

  const result = Bot.chess.move({from, to, promotion:'q'});
  if (!result) { sndIllegal(); return false; }
  if (result.captured) sndCapture(); else sndMove();
  recordCapture(result);
  renderCapturedRows();
  addBotMoveToFeed(result.san, result.color);
  renderBotBoard();
  if (botGameOverCheck()) return true;

  BD.botStatusText.textContent = '';
  const fenAfter = Bot.chess.fen();
  const sideAfter = Bot.chess.turn();
  const playerMoveNumber = Bot.moveList.filter(m => m.color === sideBefore).length;
  const OPENING_MOVES_EXEMPT = 5; // don't grade the first few book-ish moves

  if (playerMoveNumber <= OPENING_MOVES_EXEMPT) {
    if (!Bot.gameOver) triggerBotMove();
    return true;
  }

  // Sequenced (not concurrent) with the bot's own move search below, since
  // there's only one engine worker and it can only run one search at a time.
  evalBeforePromise
    .then(scoreBefore => getEval(fenAfter, 500).catch(() => null).then(scoreAfter => {
      if (Bot.gameOver) return;
      const cpBefore = scoreToCp(scoreBefore, sideBefore, sideBefore);
      const cpAfter = scoreToCp(scoreAfter, sideAfter, sideBefore);
      const delta = cpAfter - cpBefore;
      const category = classifyDelta(delta, Bot.level);
      addChatMessage(pickPhrase(category), category);
    }))
    .catch(() => {})
    .finally(() => { if (!Bot.gameOver) triggerBotMove(); });

  return true;
}

function handleBotClick(sq) {
  if (!Bot.started || Bot.gameOver || Bot.thinking) return;
  const playerTurn = Bot.playerColor === 'white' ? 'w' : 'b';
  if (Bot.chess.turn() !== playerTurn) return;

  const piece = Bot.chess.get(sq);
  if (!Bot.selectedSq) {
    if (piece && piece.color === playerTurn) {
      Bot.selectedSq = sq;
      Bot.legalMoves = Bot.chess.moves({square:sq, verbose:true});
      renderBotBoard();
    }
    return;
  }
  const from = Bot.selectedSq;
  if (from === sq) { Bot.selectedSq = null; Bot.legalMoves = []; renderBotBoard(); return; }
  Bot.selectedSq = null; Bot.legalMoves = [];
  const moved = attemptBotMove(from, sq);
  if (!moved) {
    if (piece && piece.color === playerTurn) {
      Bot.selectedSq = sq;
      Bot.legalMoves = Bot.chess.moves({square:sq, verbose:true});
    }
    renderBotBoard();
  }
}

function startBotDrag(e, sq, imgEl) {
  if (!Bot.started || Bot.gameOver || Bot.thinking) return;
  const playerTurn = Bot.playerColor === 'white' ? 'w' : 'b';
  if (Bot.chess.turn() !== playerTurn) return;
  e.preventDefault();

  Bot.selectedSq = sq;
  Bot.legalMoves = Bot.chess.moves({square:sq, verbose:true});
  document.querySelectorAll('.sq').forEach(el => {
    el.classList.remove('selected','legal-dot','legal-capture');
    if (el.dataset.sq === sq) el.classList.add('selected');
    const lm = Bot.legalMoves.find(m => m.to === el.dataset.sq);
    if (lm) el.classList.add(lm.captured ? 'legal-capture' : 'legal-dot');
  });

  imgEl.classList.add('dragging-source');
  const ghost = document.createElement('img');
  ghost.className = 'drag-ghost';
  ghost.src = imgEl.src;
  document.body.appendChild(ghost);
  const move = (ev) => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
  move(e);

  let lastOverEl = null;
  const onMove = (ev) => {
    move(ev);
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = el && el.closest ? el.closest('.sq') : null;
    if (lastOverEl && lastOverEl !== cell) lastOverEl.classList.remove('drag-over');
    if (cell) cell.classList.add('drag-over');
    lastOverEl = cell;
  };
  const onUp = (ev) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    ghost.remove();
    if (lastOverEl) lastOverEl.classList.remove('drag-over');
    imgEl.classList.remove('dragging-source');

    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const cell = el && el.closest ? el.closest('.sq') : null;
    const dropSq = cell ? cell.dataset.sq : null;

    Bot.selectedSq = null; Bot.legalMoves = [];
    document.querySelectorAll('.sq').forEach(el2 => el2.classList.remove('selected','legal-dot','legal-capture'));

    if (dropSq && dropSq !== sq) attemptBotMove(sq, dropSq);
    else renderBotBoard();
    S.suppressClick = true;
    setTimeout(() => { S.suppressClick = false; }, 50);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function renderBotBoard() {
  const chess = Bot.chess;
  const board = document.getElementById('chessboard');
  if (!board || !chess) return;
  board.innerHTML = '';

  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = [8,7,6,5,4,3,2,1];
  const dFiles = Bot.flipped ? [...files].reverse() : files;
  const dRanks = Bot.flipped ? [...ranks].reverse() : ranks;

  const history = chess.history({verbose:true});
  const lastMv = history[history.length - 1];
  const playerTurn = Bot.playerColor === 'white' ? 'w' : 'b';
  const isYourTurn = Bot.started && !Bot.gameOver && !Bot.thinking && chess.turn() === playerTurn;

  dRanks.forEach(rank => {
    dFiles.forEach(file => {
      const sq = file + rank;
      const piece = chess.get(sq);
      const fi = files.indexOf(file), ri = rank;
      const isLight = (fi + ri) % 2 === 0;

      const cell = document.createElement('div');
      cell.className = 'sq ' + (isLight ? 'light' : 'dark');
      cell.dataset.sq = sq;

      if (lastMv && (sq === lastMv.from || sq === lastMv.to)) cell.classList.add(sq === lastMv.from ? 'hl-from' : 'hl-to');

      if (isYourTurn) {
        cell.dataset.clickable = '1';
        cell.addEventListener('click', () => { if (!S.suppressClick) handleBotClick(sq); });
        if (sq === Bot.selectedSq) cell.classList.add('selected');
        const lm = Bot.legalMoves.find(m => m.to === sq);
        if (lm) cell.classList.add(lm.captured ? 'legal-capture' : 'legal-dot');
      }

      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece-img';
        img.src = PIECE_IMGS[piece.color + piece.type.toUpperCase()];
        img.alt = piece.color + piece.type;
        if (isYourTurn && piece.color === playerTurn) {
          img.classList.add('draggable');
          img.addEventListener('pointerdown', (e) => startBotDrag(e, sq, img));
        }
        cell.appendChild(img);
      }

      board.appendChild(cell);
    });
  });
}

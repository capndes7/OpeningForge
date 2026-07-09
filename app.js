// ── STATE ──
let S = {
  opening:null, variation:null, moves:[], mode:'learn',
  chess:null, currentMove:-1, flipped:false,
  testChess:null, testMove:0, selectedSq:null, legalMoves:[],
  testCorrect:0, testWrong:0, autoTimer:null, busy:false, muted:false
};

// ── SOUND ENGINE (synthesized, no external files) ──
let _actx = null;
function actx() { if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)(); return _actx; }
function playTone(freq, dur, type, vol, delay) {
  if (S.muted) return;
  try {
    const ctx = actx();
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch(e) {}
}
function sndMove()     { playTone(720, 0.09, 'triangle', 0.22); playTone(480, 0.07, 'sine', 0.12, 0.02); }
function sndCapture()  { playTone(280, 0.14, 'square', 0.14); playTone(180, 0.16, 'triangle', 0.16, 0.02); }
function sndIllegal()  { playTone(140, 0.12, 'sawtooth', 0.10); }
function sndCorrect()  { playTone(620, 0.1, 'sine', 0.2); playTone(880, 0.14, 'sine', 0.18, 0.09); }
function sndWrong()    { playTone(200, 0.22, 'sawtooth', 0.16); }
let D = {};

// ── HEADER CONTROLS ──
const openingSel   = document.getElementById('openingSelect');
const variationSel = document.getElementById('variationSelect');
const learnBtn     = document.getElementById('learnBtn');
const testBtn      = document.getElementById('testBtn');
const practiceBtn  = document.getElementById('practiceBtn');
const mainArea     = document.getElementById('mainArea');

openingSel.addEventListener('change', () => {
  const key = openingSel.value;
  variationSel.innerHTML = '<option value="">— Variation —</option>';
  variationSel.disabled = true;
  learnBtn.disabled = testBtn.disabled = practiceBtn.disabled = true;
  if (!key) { showWelcome(); return; }
  const op = OPENINGS[key];
  Object.entries(op.variations).forEach(([vk,v]) => {
    const o = document.createElement('option');
    o.value = vk; o.textContent = v.name;
    variationSel.appendChild(o);
  });
  variationSel.disabled = false;
  const varKeys = Object.keys(op.variations);
  if (varKeys.length === 1) { variationSel.value = varKeys[0]; variationSel.dispatchEvent(new Event('change')); }
});

variationSel.addEventListener('change', () => {
  if (!variationSel.value) return;
  learnBtn.disabled = testBtn.disabled = practiceBtn.disabled = false;
  loadOpening(openingSel.value, variationSel.value, 'learn');
});

learnBtn.addEventListener('click', () => { if (openingSel.value && variationSel.value) loadOpening(openingSel.value, variationSel.value, 'learn'); });
testBtn.addEventListener('click',  () => { if (openingSel.value && variationSel.value) loadOpening(openingSel.value, variationSel.value, 'test'); });
practiceBtn.addEventListener('click', () => {
  if (openingSel.value && variationSel.value && typeof loadPracticeMode === 'function') {
    if (S.autoTimer) clearTimeout(S.autoTimer);
    loadPracticeMode(openingSel.value, variationSel.value);
  }
});
document.getElementById('playBotBtn').addEventListener('click', () => { if (S.autoTimer) clearTimeout(S.autoTimer); loadBotMode(); });

function showWelcome() {
  mainArea.innerHTML = '<div id="welcome"><h1>OpeningForge</h1><p>Master your chess openings — move by move, with explanations for every idea.</p><p class="hint">↑ Select an opening above to begin</p></div>';
}

// ── LOAD OPENING ──
function loadOpening(opKey, varKey, mode) {
  if (S.autoTimer) clearTimeout(S.autoTimer);
  const op = OPENINGS[opKey]; const vr = op.variations[varKey];
  S.opening = op; S.variation = vr; S.moves = vr.moves;
  S.mode = mode; S.chess = new Chess(); S.currentMove = -1;
  S.flipped = op.color === 'black';
  S.busy = false;

  mainArea.innerHTML = '';
  const tpl = document.getElementById('appTpl');
  mainArea.appendChild(tpl.content.cloneNode(true));
  initDom();

  document.getElementById('openingTitle').textContent = op.name;
  document.getElementById('openingSubtitle').textContent = vr.name;
  document.getElementById('openingIntroText').textContent = vr.intro;

  buildMoveFeed();
  buildCoords();

  if (mode === 'learn') startLearnMode();
  else startTestMode();
}

function initDom() {
  D = {};
  ['modeBadge','progressBar','moveFeed','btnFirst','btnPrev','btnNext','btnLast',
   'learnContent','testContent','testScore','scoreCorrect','scoreWrong',
   'testInstruction','testMoveStatus','testResult','resultScore','resultMsg',
   'retryBtn','feedbackBar','autoLabel','rankLabels','fileLabels','btnFlip','btnMute'].forEach(id => {
    D[id] = document.getElementById(id);
  });
  D.btnFirst.addEventListener('click', () => goTo(-1));
  D.btnPrev.addEventListener('click',  () => goTo(S.currentMove - 1));
  D.btnNext.addEventListener('click',  () => goTo(S.currentMove + 1));
  D.btnLast.addEventListener('click',  () => goTo(S.moves.length - 1));
  D.retryBtn.addEventListener('click', startTestMode);
  D.btnFlip.addEventListener('click', () => {
    S.flipped = !S.flipped;
    buildCoords();
    renderBoard(S.mode === 'test');
  });
  D.btnMute.addEventListener('click', () => {
    S.muted = !S.muted;
    D.btnMute.textContent = S.muted ? '🔇' : '🔊';
  });
  D.btnMute.textContent = S.muted ? '🔇' : '🔊';
}

function buildCoords() {
  const files = S.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = S.flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  D.rankLabels.innerHTML = ranks.map(r => `<div class="coord-label">${r}</div>`).join('');
  D.fileLabels.innerHTML = files.map(f => `<div class="coord-label">${f}</div>`).join('');
}

// ── MOVE FEED ──
function buildMoveFeed() {
  D.moveFeed.innerHTML = '';
  const playerColor = S.opening.color; // 'white' or 'black'
  S.moves.forEach((mv, i) => {
    const isWhiteMv = mv.who === 'white';
    const isYourMove = mv.who === playerColor;
    const entry = document.createElement('div');
    entry.className = 'move-entry' + (isYourMove ? ' your-move' : '');
    entry.id = 'me-' + i;
    entry.innerHTML = `
      <div class="move-number">${isWhiteMv ? Math.floor(i/2)+1+'.' : ''}</div>
      <div class="move-info">
        <div class="move-san">${mv.san}<span class="who-badge ${isWhiteMv?'w':'b'}">${isWhiteMv?'White':'Black'}</span></div>
        <div class="move-explanation">${mv.explanation}</div>
      </div>`;
    D.moveFeed.appendChild(entry);
  });
}

// ── LEARN MODE ──
function startLearnMode() {
  S.mode = 'learn';
  D.modeBadge.className = 'mode-badge learn'; D.modeBadge.textContent = 'LEARN MODE';
  D.learnContent.style.display = 'flex'; D.learnContent.style.flexDirection = 'column'; D.learnContent.style.flex = '1'; D.learnContent.style.overflow = 'hidden';
  D.testContent.classList.remove('active');
  D.testScore.style.display = 'none';
  [D.btnFirst,D.btnPrev,D.btnNext,D.btnLast].forEach(b => b.disabled = false);
  goTo(-1);
}

function goTo(idx) {
  if (S.mode !== 'learn') return;
  if (S.autoTimer) clearTimeout(S.autoTimer);
  const prevIdx = S.currentMove;
  idx = Math.max(-1, Math.min(S.moves.length - 1, idx));
  if (idx === prevIdx + 1 && idx >= 0) {
    const mv = S.moves[idx];
    if (mv.san.includes('x')) sndCapture(); else sndMove();
  }
  S.currentMove = idx;
  S.chess = new Chess();
  for (let i = 0; i <= idx; i++) S.chess.move(S.moves[i].san);
  renderBoard(false);
  updateMoveFeed();
  updateProgress(idx + 1, S.moves.length);
  D.btnFirst.disabled = D.btnPrev.disabled = idx <= -1;
  D.btnNext.disabled = D.btnLast.disabled = idx >= S.moves.length - 1;
  D.autoLabel.textContent = '';
}

function updateMoveFeed() {
  document.querySelectorAll('.move-entry').forEach((el,i) => {
    el.classList.remove('active','visited');
    if (i === S.currentMove) el.classList.add('active');
    else if (i < S.currentMove) el.classList.add('visited');
  });
  const active = document.getElementById('me-' + S.currentMove);
  if (active) active.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function updateProgress(done, total) {
  D.progressBar.style.width = (total === 0 ? 0 : (done / total) * 100) + '%';
}

// ── TEST MODE ──
function startTestMode() {
  if (S.autoTimer) clearTimeout(S.autoTimer);
  S.mode = 'test'; S.testMove = 0;
  S.testCorrect = 0; S.testWrong = 0;
  S.selectedSq = null; S.legalMoves = [];
  S.testChess = new Chess(); S.busy = false;

  D.modeBadge.className = 'mode-badge test'; D.modeBadge.textContent = 'TEST MODE';
  D.learnContent.style.display = 'none';
  D.testContent.classList.add('active');
  D.testScore.style.display = 'flex';
  D.testResult.classList.remove('show');
  D.testMoveStatus.textContent = ''; D.testMoveStatus.className = 'test-move-status';
  D.scoreCorrect.textContent = '0'; D.scoreWrong.textContent = '0';
  [D.btnFirst,D.btnPrev,D.btnNext,D.btnLast].forEach(b => b.disabled = true);
  updateProgress(0, S.moves.length);

  renderBoard(true);
  maybeAutoMove();
}

// If the current test move is the opponent's color, play it automatically
function maybeAutoMove() {
  if (S.testMove >= S.moves.length) return;
  const mv = S.moves[S.testMove];
  const playerColor = S.opening.color;
  if (mv.who !== playerColor) {
    // Opponent's move — auto-play after delay
    S.busy = true;
    D.autoLabel.textContent = mv.who === 'white' ? 'White is thinking…' : 'Black is thinking…';
    S.autoTimer = setTimeout(() => {
      S.testChess.move(mv.san);
      S.testMove++;
      updateProgress(S.testMove, S.moves.length);
      D.autoLabel.textContent = '';
      S.busy = false;
      renderBoard(true);
      if (S.testMove >= S.moves.length) { finishTest(); return; }
      maybeAutoMove(); // in case two opponent moves in a row (shouldn't happen but safe)
      updateTestInstruction();
    }, 650);
  } else {
    updateTestInstruction();
  }
}

function updateTestInstruction() {
  if (S.testMove >= S.moves.length) return;
  const mv = S.moves[S.testMove];
  D.testInstruction.textContent = `Move ${S.testMove + 1} of ${S.moves.length} — play ${mv.who === 'white' ? 'White' : 'Black'}'s move`;
}

function handleTestClick(sq) {
  if (S.suppressClick) return;
  if (S.mode !== 'test' || S.busy || S.testMove >= S.moves.length) return;
  const expectedMv = S.moves[S.testMove];
  const playerColor = S.opening.color;
  if (expectedMv.who !== playerColor) return; // not your turn

  const toMove = S.testChess.turn();
  const piece = S.testChess.get(sq);

  if (!S.selectedSq) {
    if (piece && piece.color === toMove) {
      S.selectedSq = sq;
      S.legalMoves = S.testChess.moves({square:sq, verbose:true});
      renderBoard(true);
    }
    return;
  }

  const from = S.selectedSq;
  if (from === sq) { S.selectedSq = null; S.legalMoves = []; renderBoard(true); return; }
  S.selectedSq = null; S.legalMoves = [];
  attemptTestMove(from, sq, toMove, piece);
}

// Shared by click-to-move and drag-and-drop
function attemptTestMove(from, sq, toMoveColor, pieceAtFrom) {
  const expectedMv = S.moves[S.testMove];
  const toMove = toMoveColor !== undefined ? toMoveColor : S.testChess.turn();
  const piece = pieceAtFrom !== undefined ? pieceAtFrom : S.testChess.get(from);
  const result = S.testChess.move({from, to:sq, promotion:'q'});

  if (result) {
    const correct = result.san === expectedMv.san;
    if (!correct) { S.testChess.undo(); S.testChess.move(expectedMv.san); }

    if (correct) {
      S.testCorrect++; D.scoreCorrect.textContent = S.testCorrect;
      if (result.captured) sndCapture(); else sndMove();
      flashSquares(from, sq, true);
      showFeedback('✔ Correct!', true);
      D.testMoveStatus.textContent = '✔ ' + result.san;
      D.testMoveStatus.className = 'test-move-status correct';
    } else {
      S.testWrong++; D.scoreWrong.textContent = S.testWrong;
      sndWrong();
      flashSquares(from, sq, false);
      showFeedback('✘ Expected: ' + expectedMv.san, false);
      D.testMoveStatus.textContent = '✘ Expected: ' + expectedMv.san;
      D.testMoveStatus.className = 'test-move-status wrong';
    }

    S.testMove++;
    updateProgress(S.testMove, S.moves.length);
    renderBoard(true);

    S.busy = true;
    S.autoTimer = setTimeout(() => {
      S.busy = false;
      D.testMoveStatus.textContent = '';
      renderBoard(true);
      if (S.testMove >= S.moves.length) { finishTest(); return; }
      maybeAutoMove();
    }, 900);
    return true;

  } else {
    sndIllegal();
    if (piece && piece.color === toMove) {
      S.selectedSq = from;
      S.legalMoves = S.testChess.moves({square:from, verbose:true});
    }
    renderBoard(true);
    return false;
  }
}

function flashSquares(from, to, good) {
  const cls = good ? 'correct' : 'wrong';
  [from, to].forEach(sq => {
    const el = document.querySelector(`[data-sq="${sq}"]`);
    if (el) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 900); }
  });
}

function showFeedback(msg, good) {
  const bar = D.feedbackBar;
  bar.textContent = msg; bar.className = 'feedback-bar show ' + (good ? 'good' : 'bad');
  setTimeout(() => bar.className = 'feedback-bar', 1300);
}

function finishTest() {
  const total = S.moves.length, correct = S.testCorrect;
  const pct = Math.round(correct / total * 100);
  D.resultScore.textContent = correct + '/' + total;
  D.resultMsg.textContent = pct === 100 ? "Perfect! You've mastered this line." : pct >= 70 ? "Good work! Review the moves you missed, then try again." : "Keep practising — openings take repetition. You'll get there!";
  D.testResult.classList.add('show');
  D.testMoveStatus.textContent = '';
}

// ── BOARD RENDER ──
function renderBoard(isTest) {
  const chess = isTest ? S.testChess : S.chess;
  const board = document.getElementById('chessboard');
  if (!board) return;
  board.innerHTML = '';

  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = [8,7,6,5,4,3,2,1];
  const dFiles = S.flipped ? [...files].reverse() : files;
  const dRanks = S.flipped ? [...ranks].reverse() : ranks;

  const history = chess.history({verbose:true});
  const lastMv = history[history.length - 1];

  const playerColor = S.opening ? S.opening.color : 'white';
  const expectedMv = (isTest && S.testMove < S.moves.length) ? S.moves[S.testMove] : null;
  const isYourTurn = isTest && expectedMv && expectedMv.who === playerColor && !S.busy;

  dRanks.forEach(rank => {
    dFiles.forEach(file => {
      const sq = file + rank;
      const piece = chess.get(sq);
      const fi = files.indexOf(file), ri = rank;
      const isLight = (fi + ri) % 2 === 1;

      const cell = document.createElement('div');
      cell.className = 'sq ' + (isLight ? 'light' : 'dark');
      cell.dataset.sq = sq;

      // last move highlight
      if (lastMv && (sq === lastMv.from || sq === lastMv.to)) cell.classList.add(sq === lastMv.from ? 'hl-from' : 'hl-to');

      // test mode interactivity
      if (isTest && isYourTurn) {
        cell.dataset.clickable = '1';
        cell.addEventListener('click', () => handleTestClick(sq));
        if (sq === S.selectedSq) cell.classList.add('selected');
        const lm = S.legalMoves.find(m => m.to === sq);
        if (lm) cell.classList.add(lm.captured ? 'legal-capture' : 'legal-dot');
      }

      // piece image
      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece-img';
        img.src = PIECE_IMGS[piece.color + piece.type.toUpperCase()];
        img.alt = piece.color + piece.type;
        if (isTest && isYourTurn && piece.color === (playerColor === 'white' ? 'w' : 'b')) {
          img.classList.add('draggable');
          img.addEventListener('pointerdown', (e) => startDrag(e, sq, img));
        }
        cell.appendChild(img);
      }

      board.appendChild(cell);
    });
  });

  renderBoardAnnotations();
}

// ── ARROWS & THREAT HIGHLIGHTS (Learn mode move annotations) ──
function squareCenterPercent(sq, flipped) {
  const files = ['a','b','c','d','e','f','g','h'];
  const file = files.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10);
  let fi = file, ri = 8 - rank;
  if (flipped) { fi = 7 - fi; ri = 7 - ri; }
  return { x: (fi + 0.5) / 8 * 100, y: (ri + 0.5) / 8 * 100 };
}

function renderBoardAnnotations() {
  const board = document.getElementById('chessboard');
  if (!board) return;
  if (S.mode !== 'learn' || S.currentMove < 0) return;
  const mv = S.moves[S.currentMove];
  if (!mv) return;

  if (mv.highlightSquares) {
    mv.highlightSquares.forEach(sq => {
      const cell = board.querySelector(`.sq[data-sq="${sq}"]`);
      if (cell) cell.classList.add('threat');
    });
  }

  if (mv.arrow) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'board-annotation-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const from = squareCenterPercent(mv.arrow.from, S.flipped);
    const to = squareCenterPercent(mv.arrow.to, S.flipped);
    const color = mv.arrow.color || 'rgba(94,201,138,0.85)';
    svg.innerHTML =
      `<defs><marker id="arrowhead-learn" markerWidth="3" markerHeight="3" refX="1.4" refY="1.5" orient="auto">` +
      `<polygon points="0 0, 3 1.5, 0 3" fill="${color}"/></marker></defs>` +
      `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" ` +
      `stroke-width="2.2" marker-end="url(#arrowhead-learn)" stroke-linecap="round"/>`;
    board.appendChild(svg);
  }
}

// ── DRAG AND DROP ──
function startDrag(e, sq, imgEl) {
  if (S.mode !== 'test' || S.busy) return;
  e.preventDefault();
  const board = document.getElementById('chessboard');
  const toMove = S.testChess.turn();

  S.selectedSq = sq;
  S.legalMoves = S.testChess.moves({square:sq, verbose:true});
  document.querySelectorAll('.sq').forEach(el => {
    el.classList.remove('selected','legal-dot','legal-capture');
    if (el.dataset.sq === sq) el.classList.add('selected');
    const lm = S.legalMoves.find(m => m.to === el.dataset.sq);
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

    S.selectedSq = null; S.legalMoves = [];
    document.querySelectorAll('.sq').forEach(el2 => el2.classList.remove('selected','legal-dot','legal-capture'));

    if (dropSq && dropSq !== sq) {
      attemptTestMove(sq, dropSq, toMove, S.testChess.get(sq));
    } else {
      renderBoard(true);
    }
    S.suppressClick = true;
    setTimeout(() => { S.suppressClick = false; }, 50);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// ── KEYBOARD NAV ──
document.addEventListener('keydown', e => {
  if (S.mode !== 'learn') return;
  if (e.key === 'ArrowRight') goTo(S.currentMove + 1);
  if (e.key === 'ArrowLeft')  goTo(S.currentMove - 1);
  if (e.key === 'Home')       goTo(-1);
  if (e.key === 'End')        goTo(S.moves.length - 1);
});
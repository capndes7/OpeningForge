// ══════════════════════════════════════════════════════════════
// PRACTICE MODE — play an opening's own moves for real against a bot that
// plays the opponent's scripted replies from openings.js while you're on
// the prepared line, and hands off to the real chess engine (reusing the
// bot.js engine plumbing) the moment you go off-script.
// ══════════════════════════════════════════════════════════════

let Practice = {
  chess:null, opening:null, varKey:null, variation:null,
  playerColor:null, flipped:false,
  lineMoves:[], positionKeys:[],
  moveIdx:0, offScript:false,
  selectedSq:null, legalMoves:[],
  history:[], busy:false
};
let PD = {};

function positionKeyFromFen(fen) {
  // board + side-to-move + castling rights only — ignores en-passant/move
  // counters so harmless transpositions still count as "on the line".
  return fen.split(' ').slice(0, 3).join(' ');
}

function loadPracticeMode(opKey, varKey) {
  mainArea.innerHTML = '';
  const tpl = document.getElementById('practiceTpl');
  mainArea.appendChild(tpl.content.cloneNode(true));
  initPracticeDom();

  const opening = OPENINGS[opKey];
  const variation = opening.variations[varKey];
  Practice.opening = opening; Practice.varKey = varKey; Practice.variation = variation;
  Practice.playerColor = opening.color === 'white' ? 'w' : 'b';
  Practice.flipped = opening.color === 'black';
  Practice.chess = new Chess();
  Practice.lineMoves = variation.moves;
  Practice.moveIdx = 0;
  Practice.offScript = false;
  Practice.selectedSq = null; Practice.legalMoves = [];
  Practice.history = [];
  Practice.busy = false;

  // Precompute the position after each ply of the line once, so a player
  // move can be matched by resulting position, not brittle move order.
  Practice.positionKeys = [];
  const scratch = new Chess();
  Practice.lineMoves.forEach(m => {
    scratch.move(m.san);
    Practice.positionKeys.push(positionKeyFromFen(scratch.fen()));
  });

  buildPracticeCoords();
  PD.practiceTitle.textContent = `${opening.name} — ${variation.name}`;
  PD.practiceStatusText.textContent = `You're playing ${opening.color === 'white' ? 'White' : 'Black'}. Follow the line — the bot will respond in kind.`;
  PD.practiceExplanation.textContent = variation.intro || 'Make a move to begin.';
  PD.offScriptBanner.classList.remove('show');
  renderPracticeBoard();
  maybeAutoPlayScripted();
}

function initPracticeDom() {
  PD = {};
  ['rankLabels','fileLabels','feedbackBar','autoLabel','btnFlip','btnMute',
   'offScriptBanner','practiceUndoBtn','practiceUndoBtnSmall',
   'practiceSubtitle','practiceTitle','practiceStatusText','practiceExplanation'].forEach(id => {
    PD[id] = document.getElementById(id);
  });
  PD.btnFlip.addEventListener('click', () => { Practice.flipped = !Practice.flipped; buildPracticeCoords(); renderPracticeBoard(); });
  PD.btnMute.addEventListener('click', () => {
    S.muted = !S.muted;
    PD.btnMute.textContent = S.muted ? '🔇' : '🔊';
  });
  PD.btnMute.textContent = S.muted ? '🔇' : '🔊';
  PD.practiceUndoBtn.addEventListener('click', practiceUndo);
  PD.practiceUndoBtnSmall.addEventListener('click', practiceUndo);
}

function buildPracticeCoords() {
  const files = Practice.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = Practice.flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  PD.rankLabels.innerHTML = ranks.map(r => `<div class="coord-label">${r}</div>`).join('');
  PD.fileLabels.innerHTML = files.map(f => `<div class="coord-label">${f}</div>`).join('');
}

// Auto-plays consecutive scripted opponent moves until it's genuinely the
// player's turn again, or the prepared line has been fully played out.
function maybeAutoPlayScripted() {
  if (Practice.offScript) return;
  if (Practice.moveIdx >= Practice.lineMoves.length) {
    PD.practiceStatusText.textContent = "You've completed the prepared line! Keep playing — the bot will respond naturally from here.";
    return;
  }
  const nextMv = Practice.lineMoves[Practice.moveIdx];
  const nextTurn = Practice.chess.turn();
  const nextMvColor = nextMv.who === 'white' ? 'w' : 'b';
  if (nextMvColor !== nextTurn) return; // safety guard, shouldn't happen with valid data

  if (nextMvColor !== Practice.playerColor) {
    Practice.busy = true;
    renderPracticeBoard();
    setTimeout(() => {
      const result = Practice.chess.move(nextMv.san);
      if (!result) { Practice.busy = false; return; }
      if (result.captured) sndCapture(); else sndMove();
      Practice.moveIdx++;
      Practice.history.push(true);
      Practice.busy = false;
      renderPracticeBoard();
      PD.practiceExplanation.textContent = nextMv.explanation || '';
      PD.practiceStatusText.textContent = 'Your move.';
      maybeAutoPlayScripted();
    }, 500);
  } else {
    PD.practiceStatusText.textContent = 'Your move.';
  }
}

function handlePracticeClick(sq) {
  if (S.suppressClick) return;
  if (Practice.busy) return;
  const toMove = Practice.chess.turn();
  if (toMove !== Practice.playerColor) return;
  const piece = Practice.chess.get(sq);

  if (!Practice.selectedSq) {
    if (piece && piece.color === toMove) {
      Practice.selectedSq = sq;
      Practice.legalMoves = Practice.chess.moves({square:sq, verbose:true});
      renderPracticeBoard();
    }
    return;
  }
  const from = Practice.selectedSq;
  if (from === sq) { Practice.selectedSq = null; Practice.legalMoves = []; renderPracticeBoard(); return; }
  Practice.selectedSq = null; Practice.legalMoves = [];
  attemptPracticeMove(from, sq);
}

function attemptPracticeMove(from, to) {
  const result = Practice.chess.move({from, to, promotion:'q'});
  if (!result) { sndIllegal(); renderPracticeBoard(); return false; }
  if (result.captured) sndCapture(); else sndMove();
  Practice.history.push(true);
  renderPracticeBoard();
  if (practiceGameOverCheck()) return true;

  if (Practice.offScript) {
    triggerPracticeEngineMove();
    return true;
  }

  // Transposition-tolerant: check if this position matches this step or any
  // later step still remaining in the line, not just the exact next move.
  const key = positionKeyFromFen(Practice.chess.fen());
  let foundIdx = -1;
  for (let i = Practice.moveIdx; i < Practice.positionKeys.length; i++) {
    if (Practice.positionKeys[i] === key) { foundIdx = i; break; }
  }

  if (foundIdx !== -1) {
    Practice.moveIdx = foundIdx + 1;
    PD.practiceExplanation.textContent = Practice.lineMoves[foundIdx].explanation || '';
    maybeAutoPlayScripted();
  } else {
    Practice.offScript = true;
    PD.offScriptBanner.classList.add('show');
    PD.practiceStatusText.textContent = "That's not the move from the prepared line.";
    PD.practiceExplanation.textContent = "You're off the prepared line now. Undo to get back on track, or keep playing — the bot will respond with real moves from here.";
    triggerPracticeEngineMove();
  }
  return true;
}

function practiceGameOverCheck() {
  const c = Practice.chess;
  if (c.in_checkmate()) {
    const winner = c.turn() === 'w' ? 'Black' : 'White';
    PD.practiceStatusText.textContent = `Checkmate — ${winner} wins.`;
    return true;
  }
  if (c.in_stalemate()) { PD.practiceStatusText.textContent = 'Draw by stalemate.'; return true; }
  if (c.in_draw())      { PD.practiceStatusText.textContent = 'Draw.'; return true; }
  return false;
}

function triggerPracticeEngineMove() {
  const toMove = Practice.chess.turn();
  if (toMove === Practice.playerColor) return;
  Practice.busy = true;
  PD.autoLabel.textContent = 'Bot is thinking…';
  renderPracticeBoard();
  const fen = Practice.chess.fen();
  const level = 5; // fixed moderate strength once off-script
  getEngineMove(fen, level).then(uci => {
    let result = uciToMove(uci, Practice.chess);
    if (!result) {
      const legal = Practice.chess.moves({verbose:true});
      const pick = legal[Math.floor(Math.random() * legal.length)];
      result = Practice.chess.move({from:pick.from, to:pick.to, promotion:'q'});
    }
    if (result.captured) sndCapture(); else sndMove();
    Practice.history.push(true);
    Practice.busy = false;
    PD.autoLabel.textContent = '';
    renderPracticeBoard();
    practiceGameOverCheck();
  }).catch(() => {
    Practice.busy = false;
    PD.autoLabel.textContent = '';
    PD.practiceStatusText.textContent = "Couldn't reach the chess engine — check your connection.";
    renderPracticeBoard();
  });
}

function practiceUndo() {
  if (Practice.busy || Practice.history.length === 0) return;
  Practice.chess.undo();
  Practice.history.pop();

  const key = positionKeyFromFen(Practice.chess.fen());
  const idx = Practice.positionKeys.indexOf(key);
  if (Practice.chess.history().length === 0) {
    Practice.moveIdx = 0;
    Practice.offScript = false;
    PD.offScriptBanner.classList.remove('show');
    PD.practiceExplanation.textContent = Practice.variation.intro || '';
  } else if (idx !== -1) {
    Practice.moveIdx = idx + 1;
    Practice.offScript = false;
    PD.offScriptBanner.classList.remove('show');
    PD.practiceExplanation.textContent = Practice.lineMoves[idx].explanation || '';
  } else {
    PD.practiceExplanation.textContent = 'Still off the prepared line — undo again to keep stepping back.';
  }
  renderPracticeBoard();
  PD.practiceStatusText.textContent = Practice.chess.turn() === Practice.playerColor ? 'Your move.' : '';
  if (Practice.chess.turn() !== Practice.playerColor && !Practice.offScript) maybeAutoPlayScripted();
}

function renderPracticeBoard() {
  const chess = Practice.chess;
  const board = document.getElementById('chessboard');
  if (!board || !chess) return;
  board.innerHTML = '';

  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = [8,7,6,5,4,3,2,1];
  const dFiles = Practice.flipped ? [...files].reverse() : files;
  const dRanks = Practice.flipped ? [...ranks].reverse() : ranks;

  const history = chess.history({verbose:true});
  const lastMv = history[history.length - 1];
  const isYourTurn = !Practice.busy && chess.turn() === Practice.playerColor;

  dRanks.forEach(rank => {
    dFiles.forEach(file => {
      const sq = file + rank;
      const piece = chess.get(sq);
      const fi = files.indexOf(file), ri = rank;
      const isLight = (fi + ri) % 2 === 1;

      const cell = document.createElement('div');
      cell.className = 'sq ' + (isLight ? 'light' : 'dark');
      cell.dataset.sq = sq;

      if (lastMv && (sq === lastMv.from || sq === lastMv.to)) cell.classList.add(sq === lastMv.from ? 'hl-from' : 'hl-to');

      if (isYourTurn) {
        cell.dataset.clickable = '1';
        cell.addEventListener('click', () => handlePracticeClick(sq));
        if (sq === Practice.selectedSq) cell.classList.add('selected');
        const lm = Practice.legalMoves.find(m => m.to === sq);
        if (lm) cell.classList.add(lm.captured ? 'legal-capture' : 'legal-dot');
      }

      if (piece) {
        const img = document.createElement('img');
        img.className = 'piece-img';
        img.src = PIECE_IMGS[piece.color + piece.type.toUpperCase()];
        img.alt = piece.color + piece.type;
        if (isYourTurn && piece.color === Practice.playerColor) {
          img.classList.add('draggable');
          img.addEventListener('pointerdown', (e) => startPracticeDrag(e, sq, img));
        }
        cell.appendChild(img);
      }

      board.appendChild(cell);
    });
  });
}

function startPracticeDrag(e, sq, imgEl) {
  if (Practice.busy) return;
  if (Practice.chess.turn() !== Practice.playerColor) return;
  e.preventDefault();

  Practice.selectedSq = sq;
  Practice.legalMoves = Practice.chess.moves({square:sq, verbose:true});
  document.querySelectorAll('.sq').forEach(el => {
    el.classList.remove('selected','legal-dot','legal-capture');
    if (el.dataset.sq === sq) el.classList.add('selected');
    const lm = Practice.legalMoves.find(m => m.to === el.dataset.sq);
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

    Practice.selectedSq = null; Practice.legalMoves = [];
    document.querySelectorAll('.sq').forEach(el2 => el2.classList.remove('selected','legal-dot','legal-capture'));

    if (dropSq && dropSq !== sq) attemptPracticeMove(sq, dropSq);
    else renderPracticeBoard();
    S.suppressClick = true;
    setTimeout(() => { S.suppressClick = false; }, 50);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}
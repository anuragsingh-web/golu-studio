// Mechanic library + matching games from the ratings data.
const LIBRARY = [
  { id: 'sorting', name: 'Sorting', emoji: '🧪', desc: 'Pour, move or shelve items until every container holds one kind.', re: /sort|goods|organi[sz]|tidy|shelf|triple|pack|color ?tap|yarn/i, refs: ['Ball Sort Puzzle', 'Goods Sort', 'Water Sort Puzzle'] },
  { id: 'pathfinding', name: 'Pathfinding', emoji: '🧭', desc: 'Plan a route through a grid or maze to guide a character or flow.', re: /path|maze|longcat|snake|connect|route|flow|escape|line|car circle/i, refs: ['Flow Free', 'Longcat', 'Monument Valley'] },
  { id: 'merge', name: 'Merge', emoji: '🔮', desc: 'Combine two identical items into a higher tier; manage a growing board.', re: /merge|2048|fusion|combine/i, refs: ['Merge Mansion', 'Travel Town', 'Suika Game'] },
  { id: 'match3', name: 'Match-3', emoji: '💎', desc: 'Swap adjacent pieces to line up 3+ of a kind, chain cascades and boosters.', re: /match ?-?3|crush|candy|jewel|gem|royal match|matching/i, refs: ['Royal Match', 'Candy Crush Saga', 'Toon Blast'] },
  { id: 'tile', name: 'Tile / Block puzzle', emoji: '🧱', desc: 'Place or clear shaped blocks / tiles on a grid to clear rows, regions or pairs.', re: /block|tile|tetris|sudoku|doku|hex|mahjong|blast|wood|jigsaw/i, refs: ['Block Blast', 'Tile Explorer', 'Woodoku'] },
  { id: 'physics', name: 'Physics stacking', emoji: '🏗️', desc: 'Drop, stack and balance objects with real physics; gravity is the puzzle.', re: /stack|tower|physics|drop|fall|watermelon|bounce|coin|plinko|ball/i, refs: ['Suika Game', 'Stack', 'Tower Bloxx'] },
  { id: 'idle', name: 'Idle / Incremental', emoji: '📈', desc: 'Earn while away, upgrade producers, prestige for multipliers.', re: /idle|tycoon|clicker|business|farm|cafe|bake|kingdom|valley|town|restaurant/i, refs: ['Cookie Clicker', 'Idle Miner Tycoon', 'Egg, Inc.'] },
  { id: 'runner', name: 'Runner', emoji: '🏃', desc: 'Auto-run forward; swipe to dodge, collect and pass gates.', re: /\brun|\brush|\bdash|surf|\brac(e|ing)\b|jump/i, refs: ['Subway Surfers', 'Count Masters', 'Temple Run'] },
  { id: 'td', name: 'Tower defense', emoji: '🏰', desc: 'Place defenders along a lane to stop waves; upgrade between waves.', re: /defen[cs]e|\btd\b|tower def|zombie|siege|war/i, refs: ['Kingdom Rush', 'Bloons TD 6', 'Plants vs. Zombies'] },
  { id: 'bubble', name: 'Bubble shooter', emoji: '🫧', desc: 'Aim and fire colored bubbles to pop clusters of 3+.', re: /bubble|shoot|pop/i, refs: ['Bubble Witch Saga', 'Bubble Shooter', 'Puzzle Bobble'] },
  { id: 'screw', name: 'Screw / Bolt puzzle', emoji: '🔩', desc: 'Unscrew pins in the right order so plates fall; sort screws into colored boxes.', re: /screw|bolt|\bnuts?\b|\bpins?\b|unscrew/i, refs: ['Screw Jam', 'Wood Nuts & Bolts', 'Pin Pull'] },
  { id: 'parking', name: 'Parking / Traffic jam', emoji: '🚗', desc: 'Slide or tap vehicles out of a jammed lot in the right order.', re: /park|traffic|\bcars?\b|\bjam\b|\bbus\b|vehicle|drive/i, refs: ['Car Parking Jam 3D', 'Bus Jam', 'Unblock Me'] },
  { id: 'draw', name: 'Draw-to-solve', emoji: '✏️', desc: 'Draw lines or shapes that become physical objects or paths to solve a level.', re: /draw|brain test|\bdop\b|paint|sketch/i, refs: ['Brain It On', 'DOP: Draw One Part', 'Draw Climber'] },
  { id: 'hidden', name: 'Hidden object / Spot', emoji: '🔍', desc: 'Scan a rich scene to find listed objects or differences against a timer.', re: /hidden|find|spot|differen|search|seek/i, refs: ['June\'s Journey', 'Find It Out', 'Spot the Difference'] },
  { id: 'word', name: 'Word', emoji: '🔤', desc: 'Swipe letters to form words, fill crosswords, unlock themed packs.', re: /word|letter|crossword|scrabble|spell/i, refs: ['Wordscapes', 'Word Connect', 'Wordle'] },
  { id: 'rhythm', name: 'Rhythm / Tap timing', emoji: '🎵', desc: 'Tap, hold or swipe to the beat; timing windows grade accuracy.', re: /piano|music|beat|rhythm|tiles 3|dance|song/i, refs: ['Magic Tiles 3', 'Beat Saber', 'Piano Tiles 2'] },
  { id: 'logic', name: 'Logic / Brain teaser', emoji: '🧠', desc: 'One-screen trick puzzles that reward lateral thinking.', re: /brain|logic|riddle|tricky|iq|chess|tic tac|board/i, refs: ['Brain Test', 'Brain Out', 'Chess Pro'] },
];

function originalMechanic(game) {
  const g = (game.genres || []).filter((x) => !/mobile|mouse|premium|flash|2d|3d|games for/i.test(x));
  const lib = LIBRARY.filter((m) => m.re.test(`${game.name} ${(game.genres || []).join(' ')}`)).map((m) => m.name);
  const what = lib.length ? lib.slice(0, 2).join(' + ') : g.slice(0, 2).join(' / ') || 'casual';
  return {
    id: 'original', name: 'Original mechanic', emoji: '⭐',
    desc: `${game.name}'s own core loop (${what}${g.length ? `; genres: ${g.join(', ')}` : ''}).`,
    detected: lib,
  };
}

function mechanicsFor(game, games) {
  const text = (x) => `${x.name} ${(x.genres || []).join(' ')}`;
  const list = [originalMechanic(game), ...LIBRARY].map((m) => {
    let refGames = [];
    if (m.id === 'original') refGames = [game];
    else refGames = games.filter((x) => m.re.test(text(x))).slice(0, 4);
    return {
      id: m.id, name: m.name, emoji: m.emoji, desc: m.desc,
      games: refGames.map((x) => ({ id: x.id, name: x.name, icon: x.icon_local || x.icon_remote, icon_remote: x.icon_remote, score: x.overall_score })),
      refs: m.id === 'original' ? [] : (m.refs || []).filter((r) => !refGames.some((x) => x.name.toLowerCase().includes(r.toLowerCase().split(' ')[0]))),
    };
  });
  return list;
}

module.exports = { LIBRARY, mechanicsFor, originalMechanic };

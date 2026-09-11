import { GENERATED_LEVELS } from './generated-levels.js';

// Chapter sizes drive the level-select headings: 4x5 hand-authored + 11x6 + 13 generated = 99.
export const CHAPTERS = [
  { name: '瞬袭入门', size: 4 },
  { name: '读懂火线', size: 4 },
  { name: '破甲协议', size: 4 },
  { name: '路线大师', size: 4 },
  { name: '核心行动', size: 4 },
  { name: '深入敌后', size: 11 },
  { name: '封锁区', size: 11 },
  { name: '铁壁回廊', size: 11 },
  { name: '无声突入', size: 11 },
  { name: '高压走廊', size: 11 },
  { name: '终局回路', size: 11 },
  { name: '零秒深渊', size: 13 },
];

// Levels 1-20 are hand-authored and teach every mechanic in turn; 21-99 come from
// scripts/gen-levels.mjs. They are deliberately not distinguished anywhere past this point.
const HANDCRAFTED = [
  {
    id: 'f01', name: '静默直线', code: '01 / TRACE', parMoves: 4, difficulty: 1,
    // One verb only. Data collection and the exit condition move to F02 so the first lesson is
    // "hold, aim, release, kill" and nothing else.
    brief: '按住并拖向红色守卫，松手突袭。击破全部守卫，撤离门就会打开。',
    start: [360, 1100], portal: [360, 170], chips: [],
    enemies: [['hunter', 360, 860], ['hunter', 360, 620]], walls: [], items: [],
  },
  {
    id: 'f02', name: '折线追踪', code: '02 / ZIG', parMoves: 5, difficulty: 1.5,
    tutorial: true,
    brief: '青色数据要沿路收齐。守卫和数据全部清空，撤离门才会开启。',
    start: [100, 1100], portal: [220, 180], chips: [[440, 760], [420, 360]],
    enemies: [['hunter', 220, 900], ['hunter', 600, 560]], walls: [], items: [],
  },
  {
    id: 'f03', name: '门缝潜行', code: '03 / GATE', parMoves: 7, difficulty: 2,
    tutorial: true,
    brief: '墙体挡不住子弹，但会截断冲刺。贴着墙停下时，先横向挪开绕出去，再突袭墙后的守卫。',
    start: [620, 1100], portal: [100, 170], chips: [[600, 760], [160, 440]],
    enemies: [['hunter', 560, 920], ['hunter', 390, 610], ['hunter', 300, 270]],
    walls: [[0, 810, 470, 42], [300, 530, 420, 42]], items: [],
  },
  {
    id: 'f04', name: '链式考核', code: '04 / CHAIN', parMoves: 8, difficulty: 3,
    start: [100, 1100], portal: [360, 170], chips: [[390, 900], [620, 590], [160, 440]],
    enemies: [['hunter', 160, 930], ['hunter', 600, 750], ['hunter', 400, 570], ['hunter', 120, 220]],
    walls: [[0, 820, 400, 42], [300, 500, 420, 42]], items: [],
  },
  {
    id: 'f05', name: '掩体课程', code: '05 / COVER', parMoves: 6, difficulty: 1.8,
    brief: '新敌人：炮塔。红色虚线预告射击方向，墙体可挡子弹。青色护盾可抵挡一次伤害。',
    start: [360, 1100], portal: [220, 170], chips: [[140, 950], [360, 610], [430, 280]],
    enemies: [['turret', 120, 720], ['turret', 590, 470]], walls: [[220, 900, 280, 42]],
    items: [['shield', 620, 1030]],
  },
  {
    id: 'f06', name: '交叉火线', code: '06 / CROSS', parMoves: 8, difficulty: 2.5,
    brief: '新道具：紫色干扰器。拾取后清除场上子弹，并延迟炮塔开火。',
    start: [100, 1100], portal: [360, 170], chips: [[300, 1000], [600, 720], [160, 450]],
    enemies: [['turret', 540, 900], ['turret', 380, 600], ['turret', 120, 260]],
    walls: [[0, 820, 430, 42], [290, 520, 430, 42]], items: [['jammer', 610, 400]],
  },
  {
    id: 'f07', name: '死角切换', code: '07 / BLIND', parMoves: 8, difficulty: 3.3,
    start: [620, 1100], portal: [280, 170], chips: [[390, 800], [120, 600], [600, 300]],
    enemies: [['turret', 600, 920], ['turret', 160, 760], ['turret', 340, 440], ['turret', 500, 200]],
    walls: [[0, 850, 450, 42], [300, 700, 420, 42], [0, 360, 430, 42]], items: [],
  },
  {
    id: 'f08', name: '弹幕回廊', code: '08 / BARRAGE', parMoves: 9, difficulty: 4,
    start: [100, 1100], portal: [360, 170], chips: [[260, 980], [400, 650], [120, 400]],
    enemies: [['turret', 500, 940], ['turret', 620, 760], ['turret', 150, 600], ['turret', 350, 300], ['turret', 600, 220]],
    walls: [[0, 840, 470, 42], [280, 520, 440, 42]], items: [['shield', 620, 1060]],
  },
  {
    id: 'f09', name: '双击协议', code: '09 / DOUBLE', parMoves: 6, difficulty: 2.2,
    brief: '新敌人：重甲。需要两次命中，第一次会退回标记落点，恢复后再出手。',
    start: [140, 1080], portal: [360, 170], chips: [[340, 900], [310, 520], [430, 320]],
    enemies: [['armored', 500, 700]], walls: [], items: [],
  },
  {
    id: 'f10', name: '破甲接力', code: '10 / BREAK', parMoves: 6, difficulty: 3,
    brief: '新道具：绿色医疗包。拾取后恢复一格生命，但不会清除本关受伤记录。',
    start: [600, 1100], portal: [540, 190], chips: [[520, 920], [120, 680], [350, 360]],
    enemies: [['armored', 350, 780], ['turret', 120, 470]],
    walls: [[0, 850, 300, 42], [260, 570, 460, 42]], items: [['medkit', 620, 500]],
  },
  {
    id: 'f11', name: '双核回路', code: '11 / TWIN', parMoves: 8, difficulty: 3.8,
    start: [100, 1100], portal: [340, 170], chips: [[260, 980], [620, 680], [100, 280]],
    enemies: [['armored', 480, 860], ['turret', 430, 560], ['armored', 170, 460]],
    walls: [[0, 800, 330, 42], [0, 640, 360, 42]], items: [],
  },
  {
    id: 'f12', name: '装甲审判', code: '12 / ARMOR', parMoves: 10, difficulty: 4.5,
    start: [360, 1100], portal: [580, 170], chips: [[120, 980], [620, 650], [100, 320]],
    enemies: [['armored', 260, 850], ['turret', 500, 830], ['armored', 450, 530], ['turret', 190, 500], ['armored', 330, 250]],
    walls: [[330, 920, 390, 42], [0, 700, 420, 42], [0, 580, 350, 42], [260, 400, 460, 42]],
    items: [['jammer', 620, 1060]],
  },
  {
    id: 'f13', name: '最短路径', code: '13 / SHORT', parMoves: 9, difficulty: 3.2,
    start: [100, 1100], portal: [360, 170], chips: [[340, 990], [160, 680], [600, 280]],
    enemies: [['turret', 590, 910], ['turret', 420, 720], ['turret', 120, 470], ['armored', 360, 400]],
    walls: [[0, 830, 420, 42], [300, 600, 420, 42], [0, 330, 410, 42]], items: [['shield', 620, 1050]],
  },
  {
    id: 'f14', name: '回字迷阵', code: '14 / LOOP', parMoves: 9, difficulty: 3.8,
    start: [620, 1100], portal: [300, 170], chips: [[520, 940], [160, 570], [550, 250]],
    enemies: [['turret', 300, 900], ['armored', 120, 760], ['turret', 390, 500], ['armored', 610, 430]],
    walls: [[220, 820, 500, 42], [290, 650, 430, 42], [0, 360, 430, 42]], items: [['medkit', 100, 1040]],
  },
  {
    id: 'f15', name: '数据诱饵', code: '15 / BAIT', parMoves: 11, difficulty: 4.3,
    start: [360, 1100], portal: [370, 180], chips: [[120, 980], [450, 830], [420, 540], [100, 320], [600, 300]],
    enemies: [['turret', 220, 800], ['turret', 620, 680], ['armored', 160, 520], ['turret', 350, 250]],
    walls: [[300, 900, 420, 42], [0, 700, 390, 42], [310, 430, 410, 42]],
    items: [['shield', 640, 1050], ['jammer', 120, 800]],
  },
  {
    id: 'f16', name: '警报峰值', code: '16 / ALARM', parMoves: 11, difficulty: 5,
    start: [100, 1100], portal: [360, 170], chips: [[300, 1020], [120, 650], [590, 240]],
    enemies: [['turret', 550, 940], ['armored', 620, 760], ['turret', 380, 680], ['turret', 120, 430], ['armored', 380, 400], ['turret', 600, 170]],
    walls: [[0, 850, 430, 42], [290, 590, 430, 42], [0, 300, 420, 42]], items: [['jammer', 620, 1060]],
  },
  {
    id: 'f17', name: '静默复盘', code: '17 / RECAP', parMoves: 7, difficulty: 3.5,
    start: [620, 1100], portal: [360, 170], chips: [[300, 820], [250, 500], [600, 240]],
    enemies: [['hunter', 520, 900], ['hunter', 100, 700], ['hunter', 480, 420]],
    walls: [[280, 630, 440, 42], [0, 330, 420, 42]], items: [['medkit', 100, 1040]],
  },
  {
    id: 'f18', name: '三核护卫', code: '18 / GUARD', parMoves: 10, difficulty: 4.3,
    start: [100, 1100], portal: [360, 170], chips: [[280, 980], [390, 620], [300, 240]],
    enemies: [['armored', 520, 900], ['turret', 620, 700], ['armored', 160, 540], ['turret', 100, 330], ['armored', 560, 210]],
    walls: [[0, 820, 400, 42], [300, 500, 420, 42], [340, 280, 380, 42]],
    items: [['shield', 620, 1060], ['jammer', 100, 440]],
  },
  {
    id: 'f19', name: '无掩体', code: '19 / EXPOSED', parMoves: 11, difficulty: 4.7,
    start: [360, 1100], portal: [360, 170], chips: [[120, 1000], [420, 560], [580, 280]],
    enemies: [['turret', 300, 900], ['hunter', 520, 820], ['armored', 620, 650], ['turret', 160, 600], ['hunter', 100, 400], ['armored', 330, 320], ['turret', 600, 160]],
    walls: [], items: [['shield', 620, 1050], ['jammer', 220, 1040]],
  },
  {
    id: 'f20', name: '零秒核心', code: '20 / CORE', parMoves: 13, difficulty: 5.5,
    start: [360, 1100], portal: [360, 170], chips: [[120, 1020], [600, 650], [120, 330], [360, 220]],
    enemies: [['turret', 120, 850], ['armored', 340, 720], ['hunter', 560, 600], ['turret', 600, 450], ['armored', 360, 380], ['turret', 120, 160], ['turret', 600, 160]],
    walls: [[220, 920, 280, 42], [0, 760, 220, 42], [0, 550, 430, 42], [300, 300, 420, 42]],
    items: [['shield', 620, 1050], ['jammer', 600, 880], ['medkit', 100, 650]],
  },
];

export const LEVELS = [...HANDCRAFTED, ...GENERATED_LEVELS];

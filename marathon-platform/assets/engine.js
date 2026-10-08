/* =========================================================================
   engine.js — 马拉松报名状态引擎(纯函数,零 DOM 依赖)
   -------------------------------------------------------------------------
   这是网站、每日巡检脚本、以及后续微信小程序共用的唯一一份逻辑。
   任何状态判断只允许在这里改,禁止在别处重写 —— 否则会出现
   「网页说待缴费、邮件说已截止」这种漂移。

   同时支持两种加载方式:
     - 浏览器:  <script src="assets/engine.js"></script>  → window.ME
     - Node:    const ME = require('./assets/engine.js')
   ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ME = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

const MS_DAY = 86400000;

function parseDT(s){
  if(!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if(!m) return null;
  return new Date(+m[1], +m[2]-1, +m[3], m[4]?+m[4]:0, m[5]?+m[5]:0, 0, 0);
}
function mid(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayDiff(target, from){
  const a = parseDT(target); if(!a) return null;
  return Math.round((mid(a) - mid(from)) / MS_DAY);
}
function fmtDate(s, withTime){
  const d = parseDT(s); if(!d) return "—";
  const p = n => String(n).padStart(2,"0");
  const base = d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
  if(withTime && /[T ]\d{2}:\d{2}/.test(s)) return base + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  return base;
}
function fmtMd(s){ const d = parseDT(s); if(!d) return "—";
  return (d.getMonth()+1) + "月" + d.getDate() + "日"; }
const WD = ["周日","周一","周二","周三","周四","周五","周六"];
function weekday(s){ const d = parseDT(s); return d ? WD[d.getDay()] : ""; }

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

const SEED_RACES = [
  /* ---------- 世界马拉松大满贯 ---------- */
  { id:"chi27", name:"2027 芝加哥马拉松", en:"Bank of America Chicago Marathon",
    city:"芝加哥", country:"美国", region:"北美", tier:"maj", raceDate:"2027-10-10",
    regOpen:"2026-10-08T08:00", regClose:"2026-10-29T14:00",
    mode:"lottery", drawDate:"2026-12-08", payDeadline:"2026-12-15T23:59",
    fee:"$250 美国居民 / $260 非美国居民", quota:"约 55,000", odds:"约 25%",
    url:"https://www.chicagomarathon.com/apply", confidence:"official",
    note:"保证名额与抽签名额在<b>同一个窗口</b>申请(10/8–10/29)。时间达标者(16–34 岁男子 2:50:00、女子 3:20:00 及同类组别)可直接申请保证名额。中签后须于 12/15 前完成缴费,逾期名额直接释放。" },

  { id:"syd27", name:"2027 悉尼马拉松", en:"TCS Sydney Marathon",
    city:"悉尼", country:"澳大利亚", region:"大洋洲", tier:"maj", raceDate:"2027-08-29",
    regOpen:"2026-09-29", regClose:"2026-10-19", mode:"lottery",
    drawDate:"2026-11-03", payDeadline:null,
    fee:"A$280 澳居民 / A$330 国际", quota:"约 40,000", odds:"约 32.5%",
    url:"https://www.sydneymarathon.com/", confidence:"official",
    note:"<b>当前正在开放中。</b>抽签免费,是所有大满贯里中签率最高的一场。2026 年有 12.3 万人报名抢 4 万个名额。" },

  { id:"ber27", name:"2027 柏林马拉松", en:"Generali Berlin Marathon",
    city:"柏林", country:"德国", region:"欧洲", tier:"maj", raceDate:"2027-09-26",
    regOpen:"2026-10-01", regClose:"2026-11-12", mode:"lottery",
    drawDate:"2026-12-05", payDeadline:null,
    fee:"约 €205(以官网为准)", quota:"约 55,000", odds:"约 20%",
    url:"https://www.bmw-berlin-marathon.com/", confidence:"reported",
    note:"<b>当前正在开放中</b>,窗口长达 6 周,是最不容易错过的大满贯。2027 年起冠名由 BMW 变更为 Generali。不同信源给出的截止日略有差异(11/6 或 11/12),以官网为准。" },

  { id:"nyc27", name:"2027 纽约马拉松", en:"TCS New York City Marathon",
    city:"纽约", country:"美国", region:"北美", tier:"maj", raceDate:"2027-11-07",
    regOpen:"2027-02-04", regClose:"2027-02-25", mode:"lottery",
    drawDate:"2027-03-04", payDeadline:null,
    fee:"见官网", quota:"约 59,000", odds:"约 1%–5%",
    url:"https://www.nyrr.org/tcsnycmarathon", confidence:"projected",
    note:"全球中签率最低的大满贯之一,2026 年超 24 万人报名。备选路径:慈善名额、官方旅行社套餐、NYRR 9+1 本地计划。" },

  { id:"lon27", name:"2027 伦敦马拉松", en:"TCS London Marathon",
    city:"伦敦", country:"英国", region:"欧洲", tier:"maj", raceDate:"2027-04-25",
    regOpen:null, regClose:"2026-05-01", mode:"lottery",
    drawDate:"2026-07-09", payDeadline:null,
    fee:"£225 国际", quota:"两日赛制约 100,000", odds:"约 1.3%",
    url:"https://www.tcslondonmarathon.com/", confidence:"official",
    note:"公众抽签已于 2026-05-01 关闭,共 <b>133.8 万人</b>报名,历史最高。<b>下一步盯 Good For Age / Championship 时间达标通道 —— 预计 2026 年 10 月开放</b>,需持续关注官网。2027 年首次改为两日赛(4/24–4/25)。" },

  { id:"tok27", name:"2027 东京马拉松", en:"Tokyo Marathon",
    city:"东京", country:"日本", region:"亚洲", tier:"maj", raceDate:"2027-03-07",
    regOpen:"2026-08-14T11:00", regClose:"2026-08-28T17:00", mode:"lottery",
    drawDate:"2026-09-18", payDeadline:"2026-09-30T17:00",
    fee:"$230 海外 / ¥19,800 日本国内", quota:"40,000(第 20 届)", odds:"约 10%",
    url:"https://www.marathon.tokyo/en/participants/", confidence:"official",
    note:"第 20 届,名额增至 4 万。海外跑者<b>必须本人</b>到 Tokyo Big Sight 领物,不接受代领,比赛日也不发放。" },

  { id:"bos27", name:"2027 波士顿马拉松", en:"Boston Marathon",
    city:"波士顿", country:"美国", region:"北美", tier:"maj", raceDate:"2027-04-19",
    regOpen:"2026-09-14", regClose:"2026-09-18T17:00", mode:"qualify",
    drawDate:"2026-09-23", payDeadline:null,
    fee:"$260", quota:"约 30,000", odds:"按成绩择优",
    url:"https://www.baa.org/races/boston-marathon/", confidence:"official",
    note:"唯一不设抽签的大满贯,必须凭 BQ 达标成绩报名,且按「快者优先」录取 —— 实际需要比标准线快约 4–7 分钟。2027 新增规则:赛道净落差 1500–2999 英尺的成绩加罚 5 分钟,3000–5999 英尺加罚 10 分钟,6000 英尺以上直接不合格。" },

  { id:"cap27", name:"2027 开普敦马拉松", en:"Sanlam Cape Town Marathon",
    city:"开普敦", country:"南非", region:"非洲", tier:"maj", raceDate:"2027-05-23",
    regOpen:"2026-06-10", regClose:"2026-06-24", mode:"lottery",
    drawDate:"2026-06-26", payDeadline:null,
    fee:"见官网", quota:"约 27,000", odds:null,
    url:"https://www.capetownmarathon.com/", confidence:"official",
    note:"2027 年正式成为第 8 个大满贯,也是非洲首场。抽签已结束;慈善名额(23 家合作机构)与 80 多家官方旅行社套餐于 2026-06-26 起<b>先到先得</b>。" },

  /* ---------- 中国赛事 ---------- */
  { id:"hkg27", name:"2027 渣打香港马拉松", en:"Standard Chartered Hong Kong Marathon",
    city:"香港", country:"中国香港", region:"中国", tier:"gold", raceDate:"2027-01-17",
    regOpen:"2026-09-11T14:00", regClose:"2026-09-20T19:00", mode:"lottery",
    drawDate:"2026-10-07T14:00", payDeadline:"2026-10-10T23:59",
    fee:"HK$600 全马 / HK$520 半马 / HK$420 10K", quota:"78,000(全马 18,000)",
    odds:null, url:"https://www.hkmarathon.com/", confidence:"official",
    note:"<b>第二轮抽签结果 10/7 14:00 公布,中签者须于 10/10 23:59 前完成缴费。</b>这是最容易丢名额的环节 —— 第一轮付款期只有 7 天,第二轮只有 3 天。" },

  { id:"sha26", name:"2026 上海马拉松", en:"Shanghai Marathon",
    city:"上海", country:"中国", region:"中国", tier:"candidate", raceDate:"2026-12-06",
    regOpen:"2026-04-29T15:00", regClose:"2026-05-29T12:00", mode:"lottery",
    drawDate:"2026-06-30", payDeadline:"2026-07-20T12:00",
    fee:"¥200 中国籍(含港澳台) / $160 外籍", quota:"30,000(30 周年扩容)",
    odds:null, url:"https://www.shang-ma.com/", confidence:"official",
    note:"30 周年,马拉松项目由 23,000 扩至 30,000 人。世界大满贯候选赛事。健康跑 12/5 首次独立举办,规模 15,000。" },

  { id:"fuz26", name:"2026 福州马拉松", en:"Fuzhou Marathon",
    city:"福州", country:"中国", region:"中国", tier:"elite", raceDate:"2026-12-27",
    regOpen:"2026-09-10T20:00", regClose:"2026-09-19T17:00", mode:"lottery",
    drawDate:"2026-09-30", payDeadline:null,
    fee:"见官网", quota:"35,000(全马 20,000 / 半马 15,000)",
    odds:null, url:"https://www.fuzhou-marathon.com/", confidence:"official",
    note:"世界田联精英标牌赛事。全马直通标准:男子 2:45 内、女子 3:00 内。连续九届完赛的「榕耀跑者」可直通。" },

  { id:"gzh26", name:"2026 广州马拉松", en:"Guangzhou Marathon",
    city:"广州", country:"中国", region:"中国", tier:"gold", raceDate:"2026-12-20",
    regOpen:"2026-09-02T10:00", regClose:"2026-09-11T18:00", mode:"lottery",
    drawDate:"2026-09-26", payDeadline:null,
    fee:"¥180", quota:"30,000", odds:null,
    url:"https://www.guangzhou-marathon.com/", confidence:"official",
    note:"世界田联金标 + 中国田协金牌「双金」赛事,同时是马拉松大满贯年龄组世锦赛资格赛。新增「破全国马拉松纪录奖」12 万元。分四枪起跑(7:00/7:10/7:20/7:30),起点天河体育中心,终点海心沙。" },

  { id:"bj26", name:"2026 北京马拉松", en:"Beijing Marathon",
    city:"北京", country:"中国", region:"中国", tier:"gold", raceDate:"2026-10-18",
    regOpen:null, regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 32,000", odds:"常年低于 20%",
    url:"https://www.beijing-marathon.com/", confidence:"unknown",
    note:"「国马」,天安门起跑。中签率常年低于 20%。报名窗口以官方公告为准。" },

  { id:"hzh26", name:"2026 杭州马拉松", en:"Hangzhou Marathon",
    city:"杭州", country:"中国", region:"中国", tier:"gold", raceDate:"2026-11-01",
    regOpen:null, regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 22,000", odds:null,
    url:"https://www.hzim.org/", confidence:"unknown",
    note:"赛道从西湖跑到钱塘江,累计爬升约 131 米。报名窗口以官方公告为准。" },

  { id:"nj26", name:"2026 南京马拉松", en:"Nanjing Marathon",
    city:"南京", country:"中国", region:"中国", tier:"gold", raceDate:"2026-11-22",
    regOpen:null, regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 18,000", odds:null,
    url:"https://www.nj-marathon.com/", confidence:"unknown",
    note:"明城墙、玄武湖、夫子庙一线串联。报名窗口以官方公告为准。" },

  { id:"sz26", name:"2026 深圳马拉松", en:"Shenzhen Marathon",
    city:"深圳", country:"中国", region:"中国", tier:"gold", raceDate:"2026-12-06",
    regOpen:null, regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 30,000", odds:null,
    url:"https://www.sz-marathon.com/", confidence:"unknown",
    note:"赛道平坦(爬升约 60 米),12 月气温舒适。报名窗口以官方公告为准。" },

  { id:"tpe26", name:"2026 台北马拉松", en:"Taipei Marathon",
    city:"台北", country:"中国台湾", region:"中国", tier:"gold", raceDate:"2026-12-20",
    regOpen:null, regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 28,000", odds:null,
    url:"https://www.taipei-marathon.com/", confidence:"unknown",
    note:"赛道平坦(爬升约 40 米),12 月气温约 16℃。报名窗口以官方公告为准。" },

  /* ---------- 国际赛事(2026 收官 + 常见选择) ---------- */
  { id:"nyc26", name:"2026 纽约马拉松", en:"TCS New York City Marathon",
    city:"纽约", country:"美国", region:"北美", tier:"maj", raceDate:"2026-11-01",
    regOpen:null, regClose:"2026-02-25", mode:"lottery", drawDate:"2026-03-04", payDeadline:null,
    fee:"见官网", quota:"50,000+", odds:"约 1%",
    url:"https://www.nyrr.org/tcsnycmarathon", confidence:"official",
    note:"2026 赛季收官大满贯。抽签已于 2026 年 2 月结束。" },

  { id:"chi26", name:"2026 芝加哥马拉松", en:"Bank of America Chicago Marathon",
    city:"芝加哥", country:"美国", region:"北美", tier:"maj", raceDate:"2026-10-11",
    regOpen:null, regClose:"2025-11-18", mode:"lottery", drawDate:"2025-12-11", payDeadline:null,
    fee:"$250 / $260", quota:"约 55,000", odds:"约 25%",
    url:"https://www.chicagomarathon.com/", confidence:"official",
    note:"2026 赛季倒数第二场大满贯。赛道极平(爬升约 240 英尺),是最快赛道之一。" },

  { id:"val26", name:"2026 瓦伦西亚马拉松", en:"Maratón Valencia Trinidad Alfonso",
    city:"瓦伦西亚", country:"西班牙", region:"欧洲", tier:"platinum", raceDate:"2026-12-06",
    regOpen:null, regClose:null, mode:"fcfs", drawDate:null, payDeadline:null,
    fee:"见官网", quota:null, odds:null,
    url:"https://www.valenciaciudaddelrunning.com/", confidence:"unknown",
    note:"世界田联白金标,全球最快赛道之一(累计爬升仅 15 米)。<b>先到先得</b>,满员即止 —— 这一类赛事才真正需要盯开放时间。" },

  { id:"cim26", name:"2026 加州国际马拉松", en:"California International Marathon",
    city:"萨克拉门托", country:"美国", region:"北美", tier:"elite", raceDate:"2026-12-06",
    regOpen:null, regClose:null, mode:"fcfs", drawDate:null, payDeadline:null,
    fee:"见官网", quota:"约 9,000", odds:null,
    url:"https://runsra.org/california-international-marathon/", confidence:"unknown",
    note:"点对点净下坡赛道(下降 350+ 英尺),12 月气温 40–50°F,是公认最理想的 BQ 冲刺赛事之一。" },

  { id:"fuk26", name:"2026 福冈国际马拉松", en:"Fukuoka International Marathon",
    city:"福冈", country:"日本", region:"亚洲", tier:"gold", raceDate:"2026-12-06",
    regOpen:null, regClose:null, mode:"qualify", drawDate:null, payDeadline:null,
    fee:"见官网", quota:null, odds:null,
    url:"https://www.fukuoka-marathon.jp/", confidence:"unknown",
    note:"日本男子精英马拉松代表赛事,主要以成绩达标方式参赛,大众名额极少。" },

  { id:"bkk26", name:"2026 曼谷马拉松", en:"Amazing Thailand Marathon Bangkok",
    city:"曼谷", country:"泰国", region:"亚洲", tier:"label", raceDate:"2026-11-29",
    regOpen:null, regClose:null, mode:"fcfs", drawDate:null, payDeadline:null,
    fee:"见官网", quota:null, odds:null,
    url:"https://www.amazingthailandmarathon.com/", confidence:"unknown",
    note:"清晨起跑避开热带高温,赛道极平(爬升约 5 米)。" },

  { id:"sha27", name:"2027 上海马拉松", en:"Shanghai Marathon",
    city:"上海", country:"中国", region:"中国", tier:"candidate", raceDate:"2027-12-05",
    regOpen:"2027-05-01", regClose:null, mode:"lottery", drawDate:null, payDeadline:null,
    fee:"见官网", quota:null, odds:null,
    url:"https://www.shang-ma.com/", confidence:"projected",
    note:"按 2026 年规律推算,2027 年报名预计于 2027 年 5 月开启。<b>日期为推算,务必以官方公告为准。</b>若 2027 年正式成为大满贯,中签率会显著下降。" }
];

/* =========================================================================
   越野赛种子数据
   -------------------------------------------------------------------------
   与路跑赛事的差别,决定了它们必须单独成组:
     · 赛制不同 —— 多数不是「先到先得」,而是 ITRA 积分门槛 + 抽签,
       或 UTMB 体系的「跑石(Running Stones)+ UTMB 指数」双重门槛;
     · 材料不同 —— 强制装备(headlamp / 救生毯 / 冲锋衣 / 哨子 / 水袋容量)
       是赛前逐项检查的硬要求,漏一件直接取消资格;
     · 资格不同 —— 报名前需要 ITRA 表现分或同类距离的完赛记录。
   tier 取值:utmbfinal=UTMB 总决赛 / utmbws=UTMB 世界系列赛 / wtm=世界越野大满贯
             wmtrc=世界锦标赛 / classic=经典超长越野 / std=其他
   ========================================================================= */
const SEED_TRAIL = [

  /* ---------------- 中国 / 中国香港 ---------------- */
  { id:"hk100_27", name:"2027 香港100越野赛", en:"Anta Hong Kong 100 Ultra Marathon",
    kind:"trail", city:"香港", country:"中国香港", region:"中国", tier:"wtm",
    raceDate:"2027-01-21", dist:"34K / 53K / 96K(爬升 5,142m)",
    regOpen:"2026-07-30", regClose:"2026-08-04", drawDate:"2026-08-17", payDeadline:"2026-08-23",
    mode:"lottery", fee:"HK$880 / HK$1,120 / HK$2,180(大满贯组 HK$4,180)",
    quota:"2,800(HK100 组 1,800)", odds:null,
    url:"https://hk100ultra.com/", confidence:"official",
    note:"<b>所有选手(含精英)一律通过公开抽签,不设任何直通通道。</b>2027 年 1 月 21–23 日,三日连跑三个组别即 THE GRAND SAM 大满贯。赛道以麦理浩径为主线,含联合国教科文组织世界地质公园与香港之巅大帽山。世界越野大满贯(World Trail Majors)成员。" },

  { id:"tnf100hk27", name:"2027 The North Face 100 香港越野挑战赛",
    en:"The North Face 100 Ultra Trail Challenge Hong Kong", kind:"trail",
    city:"香港", country:"中国香港", region:"中国", tier:"std",
    raceDate:"2027-03-19", dist:"14K / 27K / 55K / 100K(个人·接力)",
    regOpen:"2026-08-10T16:00", regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"HK$380 – HK$1,650(分距离,早鸟更便宜)",
    quota:"分组别 500–1,200", odds:null,
    url:"https://www.thenorthface.com.hk/tnf-100/", confidence:"reported",
    note:"<b>先到先得,不抽签、无资格门槛。</b>2026-08-10 16:00 开放公众报名,2026-09-13 前报名享早鸟价。<b>官方未公布报名截止日,名额售罄即止 —— 请直接访问官网确认是否仍有名额或候补。</b>赛事从大埔林村许愿广场出发,穿八仙岭、大刀屻、大帽山,100K 累计爬升 5,300m 以上。" },

  { id:"panda27", name:"2027 熊猫蜀道山超级越野赛", en:"Panda Shudao Mountain Super Trail",
    kind:"trail", city:"成都·彭州", country:"中国", region:"中国", tier:"std",
    raceDate:"2027-03-26", dist:"25K / 60K / 85K³ / 105K / 160K(160K 爬升 9,300m)",
    regOpen:"2026-10-03T10:00", regClose:"2026-11-05T10:00", drawDate:"2026-11-11T14:00",
    payDeadline:null, mode:"lottery", itraMin:249,
    fee:"¥380 / ¥680 / ¥1,760 / ¥1,080 / ¥1,880", quota:"5,800", odds:null,
    url:"https://zuicool.com/news/archives/317972", confidence:"official",
    note:"<b>报名窗口当前开放中(10/3 10:00 – 11/5 10:00),11/11 14:00 公布抽签。</b>由柴古唐斯团队打造,起终点均设白鹿音乐广场。<b>按组别设 ITRA 表现分阶梯门槛:160K 需 500 分(或 3 场百公里越野 / 1 场爬升 8,000m+),105K 需 400 分,60K 需 350 分,25K 需 249 分(或半马 ≤2:30、全马 ≤6:00)</b> —— 分数不够直接报不上。超员时采用预付费抽签,未中签者 3 个工作日内全额退款。<b>报名入口在「柴古唐斯」微信公众号。</b>" },

  { id:"cgts26", name:"2026 柴古唐斯括苍越野赛", en:"Chaigutangsi Kuocang Trail Race",
    kind:"trail", city:"浙江·临海", country:"中国", region:"中国", tier:"classic",
    raceDate:"2026-10-30", dist:"25K / 50K / 105K(105K 爬升 6,677m)",
    regOpen:"2026-06-20T10:00", regClose:"2026-06-26T10:00", drawDate:"2026-07-02T14:00",
    payDeadline:null, mode:"lottery", itraMin:260,
    fee:"¥480 / ¥780 / ¥1,480", quota:"6,500", odds:null,
    url:"https://www.tsaigu.com/", confidence:"official",
    note:"国内最火爆的越野赛之一,第十一届。<b>报名设 ITRA 表现分门槛:105K 需 410 分、50K 需 360 分、25K 需 260 分</b> —— 分数不够无法报名。超员时预付费抽签,未中签全额退费。赛道从兴善门广场出发闭合环线。" },

  { id:"nh26", name:"2026 可隆宁海越野挑战赛", en:"Kolon Ninghai Trail Challenge",
    kind:"trail", city:"浙江·宁海", country:"中国", region:"中国", tier:"std",
    raceDate:"2026-11-13", dist:"YNH 25K / CNH 60K / UTNH 100K",
    regOpen:"2026-04-08T10:00", regClose:"2026-04-22T18:00", drawDate:"2026-04-29",
    payDeadline:null, mode:"lottery", fee:"见官网", quota:"6,500", odds:null,
    url:"http://nh.cnnb.com.cn/system/2026/04/09/012639027.shtml", confidence:"official",
    note:"创办于 2013 年,2019 年入选 UTWT 系列,2023 年起成为 UTMB 世界系列赛成员 —— 是国内跑者通往霞慕尼总决赛的主要跳板之一。<b>报名通过官方微信公众号「宁海越野挑战赛」进入小程序完成。</b>" },

  { id:"chongli27", name:"2027 崇礼168超级越野赛", en:"Chongli 168 Ultra Trail",
    kind:"trail", city:"河北·崇礼", country:"中国", region:"中国", tier:"classic",
    raceDate:"2027-07-09", dist:"10 个组别,30K – 192.8K(崇礼168 组 171K)",
    regOpen:"2027-01-20", regClose:"2027-04-30", drawDate:null, payDeadline:null,
    mode:"lottery", fee:"分组别,见官网", quota:"约 10,000", odds:null,
    url:"http://chongli-ultra.cn/", confidence:"projected",
    note:"亚洲单场规模最大的越野赛之一,赛道贯穿 7 个核心雪场与 2022 冬奥场馆,固定于<b>每年 7 月第二个周末</b>举办。<b>除团体组与萌娃组外全部抽签</b>;按往年规律 1 月中旬开放预报名、4 月 30 日截止或额满即止(日期为推算,以官方公告为准)。<b>资格门槛按距离阶梯:168K 需近 1 年内 1 场 100K+ 越野完赛证书,100/70/50K 需近 1 年内 1 场 50K+ 或 2 场 40K+,30K 需 1 场 20K+</b>(无需 ITRA 分,ITRA 仅用于精英通道与分区起跑)。精英选手可发邮件至 chongli168@sanfo.com 申请。" },

  { id:"gaoligong27", name:"2027 高黎贡超级山径赛", en:"Gaoligong by UTMB",
    kind:"trail", city:"云南·腾冲", country:"中国", region:"中国", tier:"utmbws",
    raceDate:"2027-05-16", dist:"约 100K(爬升 5,500m 级),另设短距离组",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"见官网", odds:null,
    url:"https://utmb.world/", confidence:"projected",
    note:"UTMB 世界系列赛中国站,办赛地为高黎贡山国家级自然保护区,完赛可获得<b>跑石(Running Stones)</b>,直接提升霞慕尼总决赛抽签权重。比赛日期为按历届规律推算,<b>报名窗口以 UTMB 世界系列赛官网公告为准。</b>" },

  /* ---------------- 亚洲其他 ---------------- */
  { id:"utmf27", name:"2027 环富士山超级越野赛", en:"Ultra-Trail Mt. Fuji",
    kind:"trail", city:"山梨·河口湖", country:"日本", region:"亚洲", tier:"utmbws",
    raceDate:"2027-04-23", dist:"UTMF 165K(爬升 7,600m)/ STY 84K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"约 4,000", odds:null,
    url:"https://www.ultratrailmtfuji.com/", confidence:"projected",
    note:"环绕富士山的世界级百英里越野,UTMB 世界系列赛成员。日期为按历届规律推算(通常在 4 月下旬)。需具备同类距离完赛经历方可报名。" },

  { id:"vietnamhl27", name:"2027 越南高地越野赛", en:"Vietnam Highlands Trail by UTMB",
    kind:"trail", city:"大叻", country:"越南", region:"亚洲", tier:"utmbws",
    raceDate:"2027-01-08", dist:"5K / 10K / 20K / 50K / 100K",
    regOpen:"2026-06-04", regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://utmb.world/", confidence:"official",
    note:"越南首次承办 UTMB 世界系列赛分站,赛道穿越浪平、比杜普、平哈特、象山四座高原山峰。持 UTMB 指数者可提前于 6/2 报名,6/4 起对公众开放。<b>官方未公布截止日,名额售罄即止。</b>" },

  { id:"thailand27", name:"2027 泰国越野赛", en:"Thailand by UTMB",
    kind:"trail", city:"清迈", country:"泰国", region:"亚洲", tier:"utmbws",
    raceDate:"2027-05-02", dist:"约 100K(爬升 5,400m 级)",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"见官网", odds:null,
    url:"https://utmb.world/", confidence:"projected",
    note:"东南亚规模最大的 UTMB 世界系列赛分站,热带山地赛道、夜间湿度极高,难度常被低估。日期为按历届规律推算,以官网公告为准。" },

  { id:"cappadocia26", name:"2026 卡帕多奇亚越野赛", en:"Cappadocia Ultra-Trail by UTMB",
    kind:"trail", city:"卡帕多奇亚", country:"土耳其", region:"亚洲", tier:"utmbws",
    raceDate:"2026-10-17", dist:"110K(爬升 3,500m),另设短距离组",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://utmb.world/", confidence:"reported",
    note:"赛道穿越卡帕多奇亚火山凝灰岩地貌与地下城遗址,景观独一无二,技术难度中等偏低,是<b>首次尝试 100K 越野的理想选择</b>。" },

  { id:"jordan27", name:"2027 约旦越野赛", en:"Jordan Ultra by UTMB",
    kind:"trail", city:"达纳", country:"约旦", region:"亚洲", tier:"utmbws",
    raceDate:"2027-03-20", dist:"50K(爬升 2,200m),另设短距离组",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://utmb.world/", confidence:"projected",
    note:"沙漠与峡谷地貌,赛事围绕达纳生物圈保护区展开。适合作为第一场境外越野(距离短、爬升温和)。" },

  /* ---------------- 欧洲 ---------------- */
  { id:"utmb27", name:"2027 HOKA UTMB 环勃朗峰越野赛", en:"HOKA UTMB Mont-Blanc",
    kind:"trail", city:"霞慕尼", country:"法国 · 意大利 · 瑞士", region:"欧洲", tier:"utmbfinal",
    raceDate:"2027-08-27", dist:"UTMB 171K(爬升 10,000m)/ CCC 101K / OCC 57K",
    regOpen:"2027-01-08", regClose:"2027-01-19", drawDate:"2027-01-26", payDeadline:null,
    mode:"stones", fee:"约 €250 – €350(分距离)", quota:"各组别限额,UTMB 约 2,300",
    odds:"按跑石加权,无固定中签率",
    url:"https://utmb.world/finals", confidence:"projected",
    note:"<b>越野跑的最高殿堂,也是全世界最难报名的越野赛。</b>报名有两道独立门槛,必须同时满足:<b>① 近 24 个月内获得至少 1 颗跑石(Running Stones)</b>(只有完赛 UTMB 世界系列赛/大满贯才能获得,完赛 UTMB/CCC/OCC 本身不给跑石);<b>② 对应距离类别有效的 UTMB 指数</b>(提交成绩的越野赛即可,无需是系列赛)。跑石越多、抽签权重越高。<b>注册窗口预计在 2027 年 1 月上旬(按 2026 年 1/8–1/19 推算),以官网公告为准。</b>小提示:TDS 组不需要跑石,是最被忽视的进入决赛周的路径。" },

  { id:"tds27", name:"2027 TDS 萨瓦穿越赛", en:"TDS — Sur les Traces des Ducs de Savoie",
    kind:"trail", city:"库马约尔", country:"意大利", region:"欧洲", tier:"utmbfinal",
    raceDate:"2027-08-25", dist:"145K(爬升 9,100m)",
    regOpen:"2027-01-08", regClose:"2027-01-19", drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"约 1,600", odds:null,
    url:"https://utmb.world/finals", confidence:"projected",
    note:"UTMB 决赛周的一员,但<b>不参与跑石抽签、也不需要跑石</b> —— 只要有 100K 或 100M 类别的有效 UTMB 指数即可报名,先到先得。爬升 9,100m 是决赛周里技术难度最高的组别之一,是<b>绕开抽签进入霞慕尼决赛周最现实的路径</b>。日期与窗口为推算,以官网为准。" },

  { id:"lavaredo27", name:"2027 拉瓦雷多越野赛", en:"La Sportiva Lavaredo Ultra Trail by UTMB",
    kind:"trail", city:"科尔蒂纳丹佩佐", country:"意大利", region:"欧洲", tier:"utmbws",
    raceDate:"2027-06-25", dist:"120K(爬升 5,850m)/ 80K / 50K / 20K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"1,000 – 5,000", odds:null,
    url:"https://www.ultratrail.it/", confidence:"projected",
    note:"赛道穿越多洛米蒂山(联合国教科文组织世界遗产),2027 年 6 月 23–27 日比赛周。UTMB 世界系列赛中<b>景观评价最高的分站之一</b>。" },

  { id:"tor27", name:"2027 巨人之旅", en:"Tor des Géants",
    kind:"trail", city:"库马约尔", country:"意大利", region:"欧洲", tier:"classic",
    raceDate:"2027-09-13", dist:"TOR330 330K(爬升 24,000m)/ 130K / 100K / 450K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"约 1,000(TOR330)", odds:null,
    url:"https://www.tordesgeants.it/", confidence:"reported",
    note:"<b>330 公里、爬升约 24,000 米、不设强制休息</b> —— 选手自行决定睡眠时间,限时约 150 小时。沿阿尔卑斯山脉 Four-Thousanders 山脚环行,穿越大帕拉迪索国家公园。2027 年 9 月 10–19 日为比赛周(TOR330 于 9/13 出发,450K 于 9/11、130K 于 9/15、100K 于 9/16)。" },

  { id:"transgran27", name:"2027 穿越大加那利越野赛", en:"The North Face Transgrancanaria",
    kind:"trail", city:"大加那利岛", country:"西班牙", region:"欧洲", tier:"wtm",
    raceDate:"2027-02-26", dist:"Classic 128K(爬升 7,500m)/ 84K / 46K / 21K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://transgrancanaria.net/", confidence:"official",
    note:"2027 年 2 月 24–28 日,横穿大加那利岛全岛,从海岸一路爬升至岛中央最高峰。<b>世界越野大满贯(World Trail Majors)成员。</b>2 月的气候相对温和,是欧洲跑者冬训季的首选目标赛。" },

  { id:"miut27", name:"2027 马德拉岛超级越野赛", en:"MIUT — Madeira Island Ultra-Trail",
    kind:"trail", city:"马德拉", country:"葡萄牙", region:"欧洲", tier:"wtm",
    raceDate:"2027-04-24", dist:"MIUT 115K(爬升 6,700m)/ 85K / 60K / 42K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.madeiraultratrail.com/", confidence:"official",
    note:"2027 年 4 月 24–25 日,从 Porto Moniz 横穿至 Machico,几乎纵贯整座马德拉岛。<b>世界越野大满贯成员</b>,以陡峭山径与月桂林景观著称,是首个采用「Legend」评级的赛事之一。" },

  { id:"swisscanyon27", name:"2027 瑞士峡谷越野赛", en:"Swiss Canyon Trail",
    kind:"trail", city:"Val-de-Travers", country:"瑞士", region:"欧洲", tier:"wtm",
    raceDate:"2027-06-05", dist:"81K / 51K / 31K / 16K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://swiss-canyon-trail.ch/", confidence:"official",
    note:"2027 年 6 月 4–6 日,世界越野大满贯成员。赛道穿越汝拉山谷的石灰岩峡谷与地下溪流地貌,<b>距离较短、爬升温和,适合作为世界越野大满贯的入门站。</b>" },

  { id:"southdowns27", name:"2027 南丘步道 100 英里", en:"South Downs Way 100",
    kind:"trail", city:"温彻斯特", country:"英国", region:"欧洲", tier:"wtm",
    raceDate:"2027-06-12", dist:"100 英里(160K),点对点",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.centurionrunning.com/", confidence:"official",
    note:"2027 年 6 月 12–13 日,沿南丘步道点对点横穿英格兰南部。<b>世界越野大满贯成员</b>,是名单里唯一一场纯粹的英国百英里,以路况友好、可跑性强著称。" },

  { id:"eiger27", name:"2027 艾格峰超级越野赛", en:"Eiger Ultra Trail by UTMB",
    kind:"trail", city:"格林德瓦", country:"瑞士", region:"欧洲", tier:"utmbws",
    raceDate:"2027-07-16", dist:"E101 101K(爬升 6,700m)/ E51 / E35 / E16",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.eigerultratrail.ch/", confidence:"projected",
    note:"UTMB 世界系列赛成员,以艾格峰北壁为背景,赛道经过冰川与高山草甸。日期按历届规律推算(通常为 7 月中旬),以官网为准。" },

  { id:"mozart27", name:"2027 莫扎特 100 越野赛", en:"Mozart 100 by UTMB",
    kind:"trail", city:"萨尔茨堡", country:"奥地利", region:"欧洲", tier:"utmbws",
    raceDate:"2027-06-05", dist:"119K(爬升 5,200m)/ 84K / 55K / 27K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"见官网", odds:null,
    url:"https://mozart100.com/", confidence:"reported",
    note:"UTMB 世界系列赛成员,环绕萨尔茨堡湖区与阿尔卑斯山麓,赛道景观多样、补给口碑好。" },

  /* ---------------- 北美 ---------------- */
  { id:"ws100_27", name:"2027 西部州 100 英里", en:"Western States 100",
    kind:"trail", city:"奥林匹克谷 → 奥本", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-06-26", dist:"100.2 英里(161K,爬升 5,500m)",
    regOpen:"2026-11-01", regClose:"2026-11-21", drawDate:"2026-12-05", payDeadline:null,
    mode:"qualify", fee:"见官网", quota:"369(受荒野保护区法案限制)", odds:"未中签可累积票数,2^(n-1)",
    url:"https://www.wser.org/", confidence:"official",
    note:"<b>世界上历史最悠久的百英里越野赛(1974 年首届)。</b>必须先完赛一场官方认可资格赛(截止 2026-11-08,100K 以下需爬升 2,500m 以上),再进入抽签。<b>抽签报名 2026-11-01 至 11-21,12-05 开奖</b>;未中签者次年的票数按 2^(n-1) 递增,2025 年帽子里有 9,993 人、共 68,724 张票。限额 369 人源于 1984 年《加州荒野法》的祖父条款。Sub-24h 获银腰带。" },

  { id:"hardrock27", name:"2027 硬石 100 英里", en:"Hardrock Hundred Endurance Run",
    kind:"trail", city:"锡尔弗顿", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-07-09", dist:"102.5 英里(165K,爬升 10,000m,均海拔 3,350m+)",
    regOpen:"2026-10-01", regClose:"2026-10-14", drawDate:"2026-12-05", payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"约 140", odds:null,
    url:"https://www.hardrock100.com/", confidence:"official",
    note:"<b>抽签报名窗口 2026-10-01 至 10-14,现在正开放中!</b>圣胡安山脉,平均海拔超过 3,350m,最高翻越 Handies Peak(4,284m),在 24–48 小时的时限里完成无补给荒野穿越 —— 被视为北美最难的高海拔百英里。2027 年为逆时针方向,比赛日 7 月 9–11 日。另设 Hardrock 奖学金(截止 11/1)。" },

  { id:"leadville27", name:"2027 利德维尔 100 英里", en:"Leadville Trail 100 Run",
    kind:"trail", city:"利德维尔", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-08-21", dist:"100 英里(161K,全程海拔 2,800m 以上)",
    regOpen:"2026-12-01", regClose:"2026-12-15", drawDate:"2027-01-10", payDeadline:null,
    mode:"lottery", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.leadvilleraceseries.com/", confidence:"official",
    note:"<b>抽签报名 2026-12-01 至 12-15,2027 年 1 月出结果</b>,抽签免费。全程海拔不低于 2,800m,两次翻越约 3,840m 的 Hope Pass,30 小时关门,2023 年退赛率约 56%。也可通过资格赛拿「硬币」(Leadville Trail Marathon / Silver Rush 50 / Austin Rattler,每场至少 35 枚)直接获得名额。" },

  { id:"cocodona27", name:"2027 科科多纳 250", en:"Cocodona 250",
    kind:"trail", city:"黑峡谷城 → 弗拉格斯塔夫", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-05-02", dist:"253.3 英里(408K,爬升 11,800m)",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"lottery", fee:"$1,995(另计手续费与税)", quota:"475 + 候补 300",
    odds:"首次完赛者 1 票,往届完赛者与核心志愿者可加票",
    url:"https://aravaiparunning.com/cocodona2/lottery", confidence:"official",
    note:"<b>2027 年起首次改为抽签制</b>(此前为直接报名),抽签窗口为 2027 年 5 月 1–18 日、6 月 1 日公布 —— 也就是说<b>本场 2027 年的报名尚未开始,5 月才开放</b>。亚利桑那州 253 英里超长距离赛,125 小时关门,45% 为单车道小径。以连续直播闻名,2026 年 Rachel Entrekin 成为首位夺得总冠军的女性。" },

  { id:"badwater27", name:"2027 恶水 135", en:"Badwater 135",
    kind:"trail", city:"死谷 → 惠特尼山门", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-07-19", dist:"135 英里(217K,爬升 4,300m)",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"invite", fee:"见官网", quota:"约 100(邀请制)", odds:null,
    url:"https://www.badwater.com/", confidence:"official",
    note:"<b>邀请制,不设公开报名。</b>从西半球最低点(海拔 -86m 的恶水盆地)跑到惠特尼山门,7 月死谷气温常破 54°C。申请者需具备超长距离完赛经历,名额仅约 100 人。2027 年 7 月 19 日举行。" },

  { id:"tahoe200_27", name:"2027 太浩湖 200", en:"Tahoe 200 Endurance Run",
    kind:"trail", city:"斯泰特莱恩", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-06-19", dist:"200.4 英里(322K)/ 62.9 英里",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.destinationtrailrun.com/tahoe200", confidence:"reported",
    note:"环绕太浩湖一周的 200 英里超长距离赛,累计爬升巨大、昼夜温差剧烈。适合已有多日赛经验的选手。" },

  { id:"blackcanyon27", name:"2027 黑峡谷越野赛", en:"Black Canyon Ultras",
    kind:"trail", city:"亚利桑那", country:"美国", region:"北美", tier:"wtm",
    raceDate:"2027-02-13", dist:"100K / 60K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.aravaiparunning.com/black-canyon/", confidence:"official",
    note:"2027 年 2 月 13–14 日,<b>世界越野大满贯成员</b>,同时也是西部州 100 的黄金门票赛(Golden Ticket)之一 —— 男女前两名可直接获得西部州名额。100K 赛道以沙漠单车道小径为主,气候温和。" },

  { id:"quebec27", name:"2027 魁北克超级越野赛", en:"Quebec Mega Trail",
    kind:"trail", city:"博普雷", country:"加拿大", region:"北美", tier:"wtm",
    raceDate:"2027-07-02", dist:"QMT 134K(爬升 6,000m)/ 100K / 50K 等 8 个组别",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://quebecmegatrail.com/", confidence:"official",
    note:"2027 年 7 月 1–4 日,<b>世界越野大满贯成员</b>,加拿大最具声望的超长越野。赛道穿越魁北克夏洛瓦山地与圣劳伦斯河岸,以技术性陡坡与湿热气候为特点。" },

  { id:"barkley27", name:"2027 巴克利马拉松", en:"Barkley Marathons",
    kind:"trail", city:"沃特堡", country:"美国", region:"北美", tier:"classic",
    raceDate:"2027-03-20", dist:"约 100 英里(5 圈 × 约 32 公里,爬升 18,000m+)",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"invite", fee:"$1.60(报名费本身)", quota:"40(实际发令通常更少)",
    odds:"无公开报名通道",
    url:"https://www.barkleymarathons.com/", confidence:"unknown",
    note:"<b>不公开报名、无官网地图、报名流程刻意不透明。</b>五圈、每圈约 32 公里,需在 12 小时内完成方能继续下一圈,累计爬升 18,000m 以上。完赛率长期低于 2%,多数年份无人完赛。<b>比赛日期官方不预先公布(通常在 3 月),此处日期为往年规律,仅供提醒参考。</b>" },

  /* ---------------- 大洋洲 ---------------- */
  { id:"uta27", name:"2027 Ultra-Trail Australia", en:"HOKA Ultra-Trail Australia by UTMB",
    kind:"trail", city:"卡通巴 · 蓝山", country:"澳大利亚", region:"大洋洲", tier:"utmbws",
    raceDate:"2027-05-14", dist:"UTAMiler 161K(爬升 7,200m)/ UTA100 101K / UTA50 51K",
    regOpen:"2026-09-17", regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"A$260 – A$1,170(分距离)", quota:"全程周末逾 8,000 人",
    odds:null, url:"https://uta.utmb.world/", confidence:"official",
    note:"<b>世界第二大 Ultra-Trail,也是英语世界规模最大的 UTMB 世界系列赛分站。</b>2027 年 5 月 13–16 日。持有效 UTMB 指数者可于 2026-09-15 提前 48 小时优先报名,公众报名 2026-09-17 开放,<b>先到先得,2026 年已全部售罄 —— 现仅剩慈善名额</b>。赛道位于蓝山世界遗产区,UTA100 需爬上 900 余级的 Giant Stairway。" },

  { id:"gpt26", name:"2026 格兰扁峰越野赛", en:"Grampians Peaks Trail 100 Miler",
    kind:"trail", city:"格兰扁 · 维多利亚州", country:"澳大利亚", region:"大洋洲", tier:"wtm",
    raceDate:"2026-11-05", dist:"GPT100 英里(160K)/ 100K / 50K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://grampianspeaks.com.au/", confidence:"reported",
    note:"2026 年 11 月 5–8 日,<b>世界越野大满贯成员</b>,沿格兰扁峰步道纵穿维多利亚州西部的砂岩山地。澳大利亚荒野型超长越野的代表。" },

  /* ---------------- 非洲 / 南美 ---------------- */
  { id:"utct26", name:"2026 开普敦超级越野赛", en:"RMB Ultra-Trail Cape Town",
    kind:"trail", city:"开普敦", country:"南非", region:"非洲", tier:"wtm",
    raceDate:"2026-11-21", dist:"UTCT 100K(爬升 4,300m)/ 50K / 35K / 21K",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"见官网", quota:"见官网", odds:null,
    url:"https://www.ultratrailcapetown.com/", confidence:"official",
    note:"2026 年 11 月 20–22 日,<b>世界越野大满贯成员</b>。赛道围绕桌山与狮头山展开,是非洲大陆最具国际影响力的越野赛,与同城的开普敦马拉松共享赛道资源。" },

  { id:"wmtrc27", name:"2027 世界山地与越野跑锦标赛", en:"World Mountain and Trail Running Championships",
    kind:"trail", city:"开普敦", country:"南非", region:"非洲", tier:"wmtrc",
    raceDate:"2027-10-06", dist:"经典上/下行、上坡、短距离、长距离四类,另设 U20 与大众组",
    regOpen:null, regClose:null, drawDate:null, payDeadline:null,
    mode:"qualify", fee:"见官网", quota:"精英约 1,200 人,大众组逾 2,000 人",
    odds:null, url:"https://www.wmtrc2027.co.za/", confidence:"official",
    note:"<b>2027 年 10 月 6–10 日,首次在非洲举办。</b>以桌山为背景,由世界山地跑协会、国际超跑协会与国际越野跑协会联合主办,80 余国、约 1,200 名选手参赛。国家代表队需通过本国协会选拔,同时开放大众组供业余选手参加。" },

  { id:"ushuaia27", name:"2027 乌斯怀亚越野赛", en:"Ushuaia by UTMB",
    kind:"trail", city:"乌斯怀亚", country:"阿根廷", region:"南美", tier:"utmbws",
    raceDate:"2027-03-31", dist:"INTI 88K(爬升 3,500m)/ KUNTUR 50K / 35K / 21K",
    regOpen:"2026-09-22T12:00", regClose:null, drawDate:null, payDeadline:null,
    mode:"fcfs", fee:"US$50 定金 + 分两期付款,合计 US$100 – US$318",
    quota:"见官网", odds:null,
    url:"https://ushuaia.utmb.world/", confidence:"official",
    note:"2027 年 3 月 31 日 – 4 月 4 日,阿根廷胡胡伊省。<b>世界上最南端的 UTMB 世界系列赛分站</b>,选手报到为 3/31 与 4/1。报名已于 2026-09-22 12:00(阿根廷时间)开放,采用定金 + 两期分期付款,<b>无固定截止日,满额即止。</b>" }
];


/* 材料清单规则 —— 按赛制生成。越野赛与路跑赛事的材料要求差别很大,单独成支。 */
function buildChecklist(race, profile){
  const list = [];
  const isCN = race.region === "中国";
  const isTrail = race.kind === "trail";

  list.push({ k:"id", t:"有效证件原件(报名时需证件号,领物时需原件)",
    why: isCN ? "中国大陆赛事需身份证;港澳台及外籍跑者用护照/通行证" : "护照有效期需覆盖比赛日之后 6 个月" });

  if(isTrail){
    /* ---- 越野赛:资格、体检、强制装备三块是硬门槛 ---- */
    list.push({ k:"proof", t:"同类距离的完赛证明(越野赛成绩,非马拉松)",
      why:"越野赛报名普遍要求同等或相近距离的山地完赛记录,路跑成绩通常不被接受" });
    if(race.tier === "utmbfinal" || race.mode === "stones"){
      list.push({ k:"stones", t:"跑石(Running Stones)+ UTMB 指数双重凭证",
        why:"跑石只有完赛 UTMB 世界系列赛才能获得,近 24 个月内至少 1 颗;UTMB 指数需对应距离类别有效" });
    } else if(race.tier === "utmbws"){
      list.push({ k:"index", t:"有效的 UTMB 指数 / ITRA 表现分",
        why:"多数 UTMB 世界系列赛分站优先向指数持有者开放报名,部分分站设最低积分门槛" });
    }
    list.push({ k:"med", t:"县级及以上医院体检报告(含心电图 + 血压),1 年内",
      why:"国内越野赛报名硬性要求;境外赛事部分要求运动医学证明或体育执照" });
    list.push({ k:"gear", t:"强制装备全套(赛前逐项检查,缺一件即取消资格)",
      why:"常见清单:头灯 + 备用电池、救生毯、冲锋衣(防水透气)、哨子、水袋总容量 1–2L、备用口粮、手机、急救绷带、保温层。UTMB 系列赛还会提供可核验的强制装备认证" });
    list.push({ k:"night", t:"夜间行进能力评估(头灯续航 + 低温应对)",
      why:"百公里以上组别几乎必然通宵,山区夜间可降至 0°C 以下,需提前实测装备与配速" });
    list.push({ k:"crew", t:"行李寄存与换装包规划",
      why:"越野赛普遍设多个换装点,需提前决定每个包放什么;越长的组别越依赖这一环" });
  } else {
    list.push({ k:"photo", t:"证件照电子版(部分赛事要求上传)",
      why:"多为近 6 个月内白底或蓝底证件照" });
    if(race.mode === "lottery" || isCN){
      list.push({ k:"proof", t:"24 个月内的完赛证明(1 次全马 或 2 次半马)",
        why:"国内赛事报名硬性要求,线上赛事成绩通常不被认可" });
    }
    if(race.mode === "qualify"){
      list.push({ k:"bq", t:"达标的马拉松成绩证书(需官方可核验)",
        why:"波士顿等达标制赛事要求上传官方成绩证明,Strava 链接无效" });
    }
    list.push({ k:"med", t:"体检报告 / 健康证明(含心电图)",
      why:"国内赛事普遍要求赛前 12 个月内体检;注意有效期" });
  }

  list.push({ k:"ec", t:"紧急联系人信息",
    why:"报名表必填项,越野赛还可能要求填写紧急联络人的关系证明" });

  if(race.tier === "maj" || isTrail){
    list.push({ k:"pay", t:"国际支付方式(Visa / Mastercard)",
      why:"境外赛事报名费需外币支付,建议提前确认卡片可境外交易" });
    list.push({ k:"visa", t:"签证与行程安排",
      why:"中签后再办签证时间紧张,建议提前评估" });
  }
  list.push({ k:"shirt", t:"参赛服尺码与鞋子信息",
    why:"部分赛事在报名时即需选定尺码,赛前不可更改" });
  return list;
}

const MODE_LABEL = { lottery:"抽签制", fcfs:"先到先得", qualify:"成绩达标制", invite:"邀请制",
                     stones:"跑石抽签" };
const MODE_TIP = {
  lottery:"报名先后不影响中签率,重点是别错过窗口和中签后按时缴费",
  fcfs:"名额有限、满员即止,需要在开放时尽快提交",
  qualify:"凭达标成绩报名,按快慢择优录取",
  invite:"需邀请或资格审核",
  stones:"跑石(Running Stones)越多抽签权重越高,需提前规划拿跑石的比赛"
};

function computeStatus(race, now){
  const rO = parseDT(race.regOpen), rC = parseDT(race.regClose);
  const dD = parseDT(race.drawDate), pD = parseDT(race.payDeadline), rD = parseDT(race.raceDate);
  const st = race.userStatus || "watching";
  const raceEnded = !!(rD && now > new Date(rD.getTime() + MS_DAY));

  /* ---- 用户显式状态优先 ---- */
  if(st === "skipped") return { key:"skipped", label:"已放弃", cls:"idle", urg:900, cd:null, cdLabel:null, cdDate:null };

  /* 已中签 → 盯缴费截止(最关键的环节) */
  if(st === "won"){
    if(pD && now <= pD){
      const d = dayDiff(race.payDeadline, now);
      return { key:"pay", label:"待缴费", cls:"pay", urg: d,
        cd:d, cdLabel:"缴费截止", cdDate:race.payDeadline,
        note:"<b>这是最容易丢名额的环节。</b>中签不等于拿到名额 —— 必须在截止时间前完成付款,逾期名额立即释放且不可恢复。" };
    }
    return { key:"lost", label:"已逾期·名额释放", cls:"idle", urg:800, cd:null, cdLabel:null, cdDate:null,
      note:"缴费截止时间已过。若确有特殊情况,可联系组委会询问是否仍在候补序列。" };
  }

  if(st === "paid"){
    if(raceEnded) return { key:"done", label:"已完赛", cls:"idle", urg:850, cd:null, cdLabel:null, cdDate:null };
    return { key:"racing", label:"已锁定·待比赛", cls:"open", urg:100,
      cd: rD ? dayDiff(race.raceDate, now) : null, cdLabel:"距比赛", cdDate:race.raceDate,
      note:"报名环节已结束,进入赛前准备:领物时间、行程住宿、装备、赛前减量训练。" };
  }

  if(raceEnded) return { key:"done", label:"已完赛", cls:"idle", urg:850, cd:null, cdLabel:null, cdDate:null };
  if(st === "lost") return { key:"closed", label:"未中签", cls:"idle", urg:760,
    cd: rD ? dayDiff(race.raceDate, now) : null, cdLabel:"距比赛", cdDate:race.raceDate };

  /* ---- 关注中 / 已提交:按窗口推进 ---- */
  if(rO && rC && now >= rO && now <= rC){
    const d = dayDiff(race.regClose, now);
    if(d <= 3) return { key:"closing", label:"即将截止", cls:"closing", urg: d,
      cd:d, cdLabel:"天后截止", cdDate:race.regClose,
      note:"窗口即将关闭。若尚未提交请立即处理。" };
    return { key:"open", label:"报名中", cls:"open", urg:30, cd:d, cdLabel:"天后截止", cdDate:race.regClose };
  }
  /* 已开放、但官方未公布截止日 —— 越野赛与先到先得赛事非常普遍。
     旧逻辑要求 regOpen 与 regClose 同时存在才判定「报名中」,
     这里会误落到「窗口待公布」,把一个正在开放的窗口写成「待公布」。
     售罄即止或额满截止的赛事,截止日往往永远不公布,必须单独成态。 */
  if(rO && !rC && now >= rO){
    return { key:"opendeadline", label:"报名中·未设截止日", cls:"open", urg:35,
      cd:null, cdLabel:null, cdDate:null,
      note:"报名通道<b>已开放,但官方未公布截止日期</b> —— 这类赛事通常是<b>名额售罄即止</b>。" +
           "建议直接访问官网确认是否仍可报名、或已进入候补。窗口开放日:" +
           fmtDate(race.regOpen, true) + "。" };
  }
  if(rO && now < rO){
    const d = dayDiff(race.regOpen, now);
    if(d <= 7) return { key:"soon", label:"即将开放", cls:"soon", urg: 9,
      cd:d, cdLabel:"天后开放", cdDate:race.regOpen,
      note:"窗口临近。建议现在把档案和材料核对一遍,开放当天可以直接提交。" };
    return { key:"notopen", label:"未开放", cls:"idle", urg: 500 - d,
      cd:d, cdLabel:"天后开放", cdDate:race.regOpen };
  }
  if(rC && now > rC){
    if(dD && now < dD) return { key:"waitdraw", label:"待抽签", cls:"wait", urg:300,
      cd:dayDiff(race.drawDate, now), cdLabel:"天后公布", cdDate:race.drawDate,
      note:"报名已提交,等待抽签。中签后<b>立即缴费</b> —— 付款期通常只有 3–7 天。" };
    /* 抽签结果已公布、但用户还没更新状态 —— 全年最需要提醒的时刻。
       中签后缴费期往往只有 3–7 天,逾期名额立即释放,而用户未必知道结果已出。 */
    if(dD && st === "watching"){
      const since = -dayDiff(race.drawDate, now);
      if(since <= 7) return { key:"drawdone", label:"结果已公布·待确认", cls:"closing", urg: since,
        cd:since, cdLabel:"天前已公布", cdDate:race.drawDate,
        note:"抽签结果已于 <b>" + since + " 天前</b>公布,但本赛事状态仍是「关注中」。请立即到官网查询:<b>中签后须在 3–7 天内完成缴费,逾期名额立即释放且不可恢复。</b>查到结果后,把卡片右侧状态改为「已中签」或「未中签」,系统会自动接管后续倒计时。" };
    }
    if(st === "submitted") return { key:"pending", label:"已报名·待结果", cls:"wait", urg:320, cd:null, cdLabel:null, cdDate:null };
    return { key:"closed", label:"已截止", cls:"idle", urg:700,
      cd: rD ? dayDiff(race.raceDate, now) : null, cdLabel:"距比赛", cdDate:race.raceDate };
  }

  /* ---- 窗口数据缺失 ---- */
  const dToRace = rD ? dayDiff(race.raceDate, now) : null;
  if(dToRace !== null && dToRace <= 45){
    return { key:"unknown", label:"窗口未记录", cls:"idle", urg:450,
      cd:dToRace, cdLabel:"距比赛", cdDate:race.raceDate,
      note:"距比赛仅 <b>" + dToRace + " 天</b>,该赛事报名窗口大概率已经关闭(国内赛事通常在赛前 1–2 个月前截止),而本系统未收录其报名日期。建议直接访问官网确认,并点「编辑」补录窗口日期 —— 明年可以直接复用。" };
  }
  return { key:"unknown", label:"窗口待公布", cls:"idle", urg:600,
    cd:dToRace, cdLabel:"距比赛", cdDate:race.raceDate,
    note:"官方尚未公布报名时间。官网入口已保存,公布后请点击「编辑」补上窗口日期,系统即可自动接管倒计时。" };
}


const URG_CLS = { pay:"u-red", drawdone:"u-amber", closing:"u-amber", open:"u-teal",
                  opendeadline:"u-teal", soon:"u-blue",
                  waitdraw:"u-purple", pending:"u-purple", unknown:"u-grey",
                  notopen:"u-grey", closed:"u-grey", done:"u-grey", skipped:"u-grey",
                  lost:"u-grey", racing:"u-teal" };

/* 赛事库「报名中 / 已截止 / 所有」过滤用 —— 把 15 态归类为三种报名阶段。
   分类必须由引擎驱动(红线 4),界面层只调用、不得自行判断状态属于哪一类。
   - open   : 报名窗口仍在进行(含待缴费 / 待抽签 / 即将截止)
   - closed : 报名窗口已关闭(含未中签 / 比赛中 / 已完赛 / 已跳过)
   - other  : 尚未开放 / 待公布(soon / notopen / unknown / pending) —— 只在「所有」里出现
   注:computeStatus 在 st==="lost" 时返回 key="closed"(标签「未中签」),所以这里按真实 s.key 覆盖全态即可。 */
const PHASE_OPEN   = ["open", "opendeadline", "pay", "drawdone", "closing", "waitdraw"];
const PHASE_CLOSED = ["closed", "lost", "racing", "done", "skipped"];
function phaseOf(key) {
  if (PHASE_OPEN.indexOf(key) >= 0) return "open";
  if (PHASE_CLOSED.indexOf(key) >= 0) return "closed";
  return "other";
}

/* 报名窗口「尚未公布 / 未开放 / 待定」的赛事:phaseOf 归为 "other"。
   即 soon / notopen / unknown / pending 这四类 —— 它们既没开放也没截止,
   不宜归进「报名中」或「已截止」,在赛事库与每日摘要里单独提示「待公布」。 */
function isWindowPending(key) { return phaseOf(key) === "other"; }

const EMPTY_PROFILE = {
  name:"", nameEn:"", gender:"", birth:"", idType:"身份证", idNo:"", phone:"", email:"",
  city:"", country:"中国", blood:"", shirt:"", shoe:"", travel:"愿意",
  ecName:"", ecRel:"", ecPhone:"",
  pbFull:"", pbFullRace:"", pbFullDate:"", pbHalf:"", pbHalfRace:"", pbHalfDate:"",
  trailMax:"", trailMaxRace:"", trailMaxDate:"", itra:"",
  medDate:"", medMonths:12, certPlace:"", budget:"", radius:"国内任意", notes:""
};

function ageFromBirth(birth, ref){
  const d = parseDT(birth); if(!d) return null;
  const t = ref || new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if(m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}

/* 从 dist 文本里取出最长组别距离(公里),用于判断「越野完赛距离是否够」。
   例:"UTMB 171K(爬升 10,000m)/ CCC 101K / OCC 57K" → 171
       "100 英里(160K)" → 160 */
function maxDistKm(race){
  const s = String((race && race.dist) || "");
  const hits = s.match(/(\d{2,3})\s*[Kk](?![a-zA-Z])/g) || [];
  const km = hits.map(function(x){ return parseInt(x, 10); })
                .filter(function(n){ return n >= 20 && n <= 500; });
  if(km.length) return Math.max.apply(null, km);
  const mi = s.match(/(\d{2,3})\s*英里/);
  if(mi) return Math.round(parseInt(mi[1], 10) * 1.609);
  return null;
}

/* 越野赛强制装备清单:按最长组别距离分级。返回字符串数组。
   赛前逐项核对,缺一件即取消资格 —— 用于「报名预填辅助」自动附在资料后面,
   也供详情页材料清单参考。不读写任何状态,纯函数。 */
function trailGearList(race) {
  const km = maxDistKm(race);
  const gear = [
    "头灯 + 备用电池",
    "救生毯",
    "防水透气冲锋衣(硬壳)",
    "哨子",
    "水袋(总容量 1–2L)",
    "备用口粮(能量胶 / 能量棒)",
    "手机(保持开机、存好紧急联系人)",
    "急救绷带",
    "保温层(备用衣物)"
  ];
  if (km && km >= 50) gear.push("可核验的强制装备认证(UTMB 系列赛要求)");
  if (km && km >= 100) gear.push("登山杖(夜间行进支撑)", "额外备用光源", "防风手套");
  return gear;
}

function profileWarnings(race, profile){
  const w = [];
  const p = profile || {};
  const isTrail = race.kind === "trail";
  if(!p.name || !p.idNo) w.push("档案未填写完整:缺少姓名或证件号码,无法报名");

  /* ---------- 越野赛专属:完赛资历、ITRA 门槛、跑石 ---------- */
  if(isTrail){
    const need = maxDistKm(race);
    if(!(p.trailMax && Number(p.trailMax) > 0)){
      w.push("缺少越野赛完赛记录:越野赛普遍要求同类距离的山地完赛证明,马拉松成绩通常不被接受");
    } else {
      const mine = Number(p.trailMax);
      if(p.trailMaxDate){
        const td = parseDT(p.trailMaxDate);
        if(td && (new Date() - td) / MS_DAY > 730) w.push("越野成绩记录已超过 24 个月,多数赛事要求近 2 年内的成绩");
      }
      if(need && mine < need){
        w.push("该赛事最长组别 " + need + "K,你的最长越野完赛为 " + mine +
               "K —— 报长组别前建议先补齐距离,或改报短组别");
      }
    }
    if(race.itraMin){
      if(!p.itra) w.push("该赛事设 ITRA 表现分门槛(最低 " + race.itraMin + " 分),请先在档案里填写 ITRA 表现分");
      else if(Number(p.itra) < race.itraMin) w.push("ITRA 表现分 " + p.itra + " 低于本赛事门槛 " + race.itraMin + " 分,报名会被拒");
    }
    if(race.tier === "utmbfinal" || race.mode === "stones"){
      w.push("UTMB 总决赛需「跑石 + UTMB 指数」双门槛 —— 跑石只能通过完赛 UTMB 世界系列赛获得,指数需对应距离类别近 2 年内有效,需提前一年规划");
    }
    if(race.mode === "qualify"){
      w.push(race.tier === "wmtrc"
        ? "该赛事为世界锦标赛,需由本国协会选拔入选国家队;大众组另走公开报名,两者名额不通用"
        : "该赛事为资格赛制:报名前须先完赛一场官方认可的资格赛(须在指定时间窗内完成,虚拟赛不被接受)");
    }
  }

  if(race.region === "中国"){
    if(!isTrail){
      const hasProof = (p.pbFull && p.pbFullDate) || (p.pbHalf && p.pbHalfDate);
      if(!hasProof) w.push("缺少24个月内的完赛证明(1次全马或2次半马),国内赛事报名会被拒");
      else{
        const d = parseDT(p.pbFullDate || p.pbHalfDate);
        if(d && (new Date() - d) / MS_DAY > 730) w.push("已有成绩记录已超过 24 个月,可能不再被认可");
      }
    }
    if(!p.medDate) w.push("未填写体检报告日期,国内赛事普遍要求赛前 12 个月内体检");
    else{
      const d = parseDT(p.medDate), mo = Number(p.medMonths) || 12;
      const exp = new Date(d.getFullYear(), d.getMonth() + mo, d.getDate());
      const left = Math.round((exp - new Date()) / MS_DAY);
      if(left < 0) w.push("体检报告已过期(" + (mo) + " 个月有效期),需重新体检");
      else if(left <= 45) w.push("体检报告将在 " + left + " 天后过期,建议尽快更新");
    }
  }
  /* 达标制仅适用于路跑(马拉松 BQ)。越野赛的「qualify」指需先完赛资格赛,另有专门判断 */
  if(!isTrail && race.mode === "qualify" && !p.pbFull) w.push("该赛事为成绩达标制,需先填写全马最好成绩");
  if(!isTrail && race.mode === "qualify" && p.pbFull){
    const secs = parseHMS(p.pbFull);
    const age = ageFromBirth(p.birth);
    /* 各年龄组男子达标线(芝加哥/波士顿通用参照) */
    const STDS = [[34,"2:50:00"],[39,"3:00:00"],[44,"3:05:00"],[49,"3:15:00"],[54,"3:20:00"],
                  [59,"3:30:00"],[64,"3:50:00"],[69,"4:05:00"],[74,"4:20:00"],[79,"4:35:00"],[999,"4:50:00"]];
    const std = age === null ? "2:50:00" : (STDS.find(s => age <= s[0]) || STDS[STDS.length-1])[1];
    const stdSec = parseHMS(std);
    if(secs && stdSec && secs > stdSec){
      w.push("当前全马成绩 " + p.pbFull + " 未达" + (age === null ? "常见" : age + " 岁组") +
             "达标线 " + std + ",暂不具备保证名额资格");
    }
  }
  return w;
}

function parseHMS(s){
  const m = String(s||"").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!m) return null;
  return m[3] ? (+m[1])*3600 + (+m[2])*60 + (+m[3]) : (+m[1])*60 + (+m[2]);
}

function profileBlock(race, profile){
  const p = profile || {};
  const L = [];
  L.push("===== 报名资料 · " + (race ? race.name : "通用") + " =====");
  L.push("姓名:" + (p.name || "【未填】"));
  if(p.nameEn) L.push("拼音 / 英文名:" + p.nameEn);
  if(p.gender) L.push("性别:" + p.gender);
  if(p.birth) L.push("出生日期:" + p.birth + (ageFromBirth(p.birth) !== null ? "(" + ageFromBirth(p.birth) + " 岁)" : ""));
  L.push("证件类型:" + (p.idType || "身份证"));
  L.push("证件号码:" + (p.idNo || "【未填】"));
  L.push("手机号:" + (p.phone || "【未填】"));
  if(p.email) L.push("邮箱:" + p.email);
  if(p.city || p.country) L.push("常住地:" + [p.country, p.city].filter(Boolean).join(" "));
  if(p.blood) L.push("血型:" + p.blood);
  if(p.shirt) L.push("参赛服尺码:" + p.shirt);
  if(p.shoe) L.push("鞋码:" + p.shoe);
  if(p.ecName) L.push("紧急联系人:" + p.ecName + (p.ecRel ? "(" + p.ecRel + ")" : "") + " " + (p.ecPhone || ""));
  if(p.pbFull){
    const ref = [p.pbFullRace, p.pbFullDate].filter(Boolean).join(" / ");
    L.push("全马最好成绩:" + p.pbFull + (ref ? "(" + ref + ")" : ""));
  }
  if(p.pbHalf){
    const ref = [p.pbHalfRace, p.pbHalfDate].filter(Boolean).join(" / ");
    L.push("半马最好成绩:" + p.pbHalf + (ref ? "(" + ref + ")" : ""));
  }
  if(p.trailMax){
    const ref = [p.trailMaxRace, p.trailMaxDate].filter(Boolean).join(" / ");
    L.push("最长越野完赛:" + p.trailMax + " 公里" + (ref ? "(" + ref + ")" : ""));
  }
  if(p.itra) L.push("ITRA 表现分:" + p.itra);
  if(p.medDate) L.push("最近体检日期:" + p.medDate);
  if(p.notes) L.push("备注:" + p.notes);
  L.push("");
  if(race && race.kind === "trail"){
    var gkm = maxDistKm(race);
    L.push("【越野赛·强制装备清单】(按最长组别 " + (gkm ? gkm + "K" : "未知距离") + " 自动列出,赛前逐项核对,缺一件即取消资格)");
    L.push(trailGearList(race).map(function(g,i){ return (i+1) + ". " + g; }).join("\n"));
    L.push("");
  }
  L.push("—— 报名后请回到「马拉松报名指挥中心」把该赛事状态改为「已提交报名」,系统会在抽签日和缴费截止日提醒你。");
  return L.filter(x => x !== "").join("\n");
}

/* ---------- ICS 导出 ---------- */
function icsEscape(s){
  return String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
}
function icsStamp(d){
  const p = n => String(n).padStart(2,"0");
  return d.getUTCFullYear() + p(d.getUTCMonth()+1) + p(d.getUTCDate()) + "T" +
         p(d.getUTCHours()) + p(d.getUTCMinutes()) + "00Z";
}
function icsDate(d){ const p = n => String(n).padStart(2,"0");
  return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()); }

function buildICS(allRaces, onlyId){
  const races = onlyId ? allRaces.filter(r => r.id === onlyId) : allRaces;
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Marathon Registrar//CN",
                 "CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:马拉松报名关键日期"];
  const stamp = icsStamp(new Date());
  let n = 0;
  const add = (uid, title, dateStr, desc, alarmMin) => {
    const d = parseDT(dateStr); if(!d) return;
    const end = new Date(d.getTime() + 30*60000);
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + uid + n + "@marathon-platform");
    lines.push("DTSTAMP:" + stamp);
    lines.push("DTSTART:" + icsDate(d) + "T" + String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0") + "00");
    lines.push("DTEND:" + icsDate(end) + "T" + String(end.getHours()).padStart(2,"0") + String(end.getMinutes()).padStart(2,"0") + "00");
    lines.push("SUMMARY:" + icsEscape(title));
    if(desc) lines.push("DESCRIPTION:" + icsEscape(desc));
    lines.push("BEGIN:VALARM"); lines.push("TRIGGER:-PT" + alarmMin + "M");
    lines.push("ACTION:DISPLAY"); lines.push("DESCRIPTION:" + icsEscape(title));
    lines.push("END:VALARM"); lines.push("END:VEVENT");
    n++;
  };
  races.forEach(r => {
    const base = r.name + " · " + (r.city || "");
    const trailTip = r.kind === "trail"
      ? "\n⚠️ 越野赛:强制装备需提前逐项核对(头灯+备用电池 / 救生毯 / 冲锋衣 / 哨子 / 水袋容量 / 备用口粮 / 急救绷带),赛前检查缺一件即取消资格。"
      : "";
    if(r.regOpen)  add("open-",  "【报名开放】" + r.name, r.regOpen,  "报名通道开启。官网:" + r.url + "\n" + (MODE_TIP[r.mode]||""), 1440);
    if(r.regClose) add("close-", "【报名截止】" + r.name, r.regClose, "报名窗口关闭,务必在此前完成提交。官网:" + r.url, 2880);
    if(r.drawDate) add("draw-",  "【抽签公布】" + r.name, r.drawDate, "抽签结果公布。中签后请立即缴费 —— 付款期通常只有 3–7 天。官网:" + r.url, 1440);
    if(r.payDeadline) add("pay-", "【缴费截止】" + r.name, r.payDeadline, "⚠️ 最关键的截止时间。逾期名额立即释放,不可恢复。官网:" + r.url, 4320);
    if(r.raceDate) add("race-",  "【比赛日】" + r.name, r.raceDate, base + "\n官网:" + r.url + trailTip, r.kind === "trail" ? 4320 : 1440);
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/* =========================================================================
   目录聚合
   -------------------------------------------------------------------------
   kind: "road" = 马拉松 / 路跑(默认,历史数据未标 kind 的按路跑处理)
         "trail" = 越野赛
   ========================================================================= */
const KIND_LABEL = { road:"马拉松 / 路跑", trail:"越野赛" };
function kindOf(r){ return (r && r.kind === "trail") ? "trail" : "road"; }
const SEED_ALL = SEED_RACES.concat(SEED_TRAIL);

/* =========================================================================
   云端合并(纯函数,可回归测试)
   -------------------------------------------------------------------------
   只合并「同步安全子集」: watching / checklists / settings / custom。
   profile(姓名/身份证/手机号/紧急联系人)绝不在 blob 里,故不会被合并。
   规则:
     watching   按 raceId 并集;同一场冲突时取 updatedAt 较新的一条
     checklists 按 raceId∪勾选项并集;只要任一侧为 true 即 true(true 胜出)
     settings   本地优先(Object.assign(cloud, local))
     custom     按 id 并集;id 冲突时本地优先
   ========================================================================= */
function mergeStates(local, cloud) {
  local = local || {}; cloud = cloud || {};
  var watching = Object.assign({}, local.watching || {});
  var cw = cloud.watching || {};
  Object.keys(cw).forEach(function (id) {
    var c = cw[id] || {}, l = watching[id];
    if (!l) { watching[id] = c; return; }
    var ct = c.updatedAt || c.addedAt || "", lt = l.updatedAt || l.addedAt || "";
    if (ct > lt) watching[id] = c; // 云端更新 -> 取云端
  });
  var checklists = Object.assign({}, local.checklists || {});
  var cc = cloud.checklists || {};
  Object.keys(cc).forEach(function (id) {
    var src = cc[id] || {}, dst = checklists[id] || {};
    Object.keys(src).forEach(function (k) { if (src[k]) dst[k] = true; });
    checklists[id] = dst;
  });
  var settings = Object.assign({}, cloud.settings || {}, local.settings || {});
  var custom = (local.custom || []).slice();
  var seen = {}; custom.forEach(function (r) { seen[r.id] = true; });
  (cloud.custom || []).forEach(function (r) { if (!seen[r.id]) { custom.push(r); seen[r.id] = true; } });
  return {
    watching: watching,
    checklists: checklists,
    settings: settings,
    custom: custom,
    savedAt: cloud.savedAt || local.savedAt || null
  };
}

return {
  MS_DAY, parseDT, mid, dayDiff, fmtDate, fmtMd, WD, weekday, esc,
  SEED_RACES, SEED_TRAIL, SEED_ALL, KIND_LABEL, kindOf,
  buildChecklist, MODE_LABEL, MODE_TIP,
  computeStatus, phaseOf, isWindowPending, URG_CLS, EMPTY_PROFILE, ageFromBirth, profileWarnings, maxDistKm,
  trailGearList, parseHMS, profileBlock, icsEscape, icsStamp, icsDate, buildICS,
  mergeStates
};
});

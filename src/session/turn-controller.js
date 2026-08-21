// src/session/turn-controller.js
//
// Giai doan 3 (xem docs/roadmap.md). Noi DUY NHAT duoc phep gui
// response.create/response.cancel len OpenAI Realtime API. Khong co code
// nao khac trong du an duoc phep tu goi thang 2 lenh nay - moi yeu cau
// "noi" phai di qua say() o day.
//
// VI SAO CAN MODULE NAY: ban cu (session-ws.js) rai rac nhieu cho tu goi
// response.create/cancel, dan toi 3 loai race condition hay gap:
//   1. "Hai response cung gui" - 2 noi goi say() gan nhau, ca 2 deu gui
//      response.create, OpenAI nhan duoc 2 yeu cau chong nhau.
//   2. "Cancel nham response" - huy response bang cach doan (khong dung
//      response_id that), co the huy nham response MOI thay vi response
//      CU dinh huy.
//   3. "Retry mo khoa" - goi lai (retry) ma quen state cu, tin hieu tra
//      ve tu lan goi truoc lam sai lech state cua lan goi sau.
//
// CACH GIAI: dung "generation token" + hang doi FIFO. Moi lan say() duoc
// goi (moi la yeu cau moi hay retry) deu tang bien dem `generation` len 1
// va day 1 phan tu moi vao hang doi cho response-started. Khi say() huy
// response dang cho/dang chay, TAT CA phan tu con trong hang doi (va
// response dang active, neu co) bi danh dau "da huy". Tin hieu
// response-started tiep theo luon duoc ghep voi phan tu O DAU hang doi
// (dung thu tu server xu ly response.create) - neu phan tu do da bi danh
// dau huy, day chinh la tin hieu "tre" tu generation cu, bi bo qua co y,
// khong phai loi (khong the chi so sanh voi bien `generation` hien tai vi
// bien nay dung chung, khong tu phan biet duoc tin hieu thuoc lan say()
// nao - xem Race 3 trong test/turn-controller.test.mjs).

export function createTurnController(ws, options = {}) {
  const log = options.log ?? (() => {});

  let generation = 0;
  // Hang doi cac response.create DA GUI nhung CHUA nhan duoc response-started
  // tuong ung, theo DUNG THU TU da gui (FIFO). Dua tren hanh vi OpenAI
  // Realtime API: response.created luon duoc server gui gan nhu ngay khi
  // nhan duoc response.create (truoc khi mot response.cancel gui SAU do co
  // hieu luc) - nen response-started tiep theo luon khop voi phan tu O DAU
  // hang doi, KE CA khi phan tu do da bi minh CHU DONG huy roi
  // (cancelled=true). Day la co che phat hien "tin hieu tre tu generation
  // cu" (Race 3) - chi dung generation counter khong du, vi generation la 1
  // bien dung chung, khong tu phan biet duoc tin hieu tra ve thuoc lan
  // say() nao neu chi so sanh voi generation HIEN TAI.
  let queue = [];

  // id + generation cua response DANG CHAY, da duoc server xac nhan va
  // CHUA bi huy - day la response duy nhat duoc phep dung id de huy dung
  // (fix "cancel nham response" cua ban cu).
  let activeResponseId = null;
  let activeGeneration = null;

  function send(obj) {
    ws.send(JSON.stringify(obj));
    log("out", obj);
  }

  // [20/08/2026->Giai doan 3] 4 kieu noi tuong ung 4 cach ban cu tung
  // dung (_requestModelReply, _openDanhBoConfirmTurn, _speakVerbatim):
  //   "auto"      - de model tu quyet dinh (hoi dap tu do).
  //   "guided"    - dinh huong noi dung qua instructions, model van tu
  //                 dat cau.
  //   "verbatim"  - ep doc dung nguyen van 1 cau cho truoc (dung khi CODE
  //                 da tu xac dinh noi dung, vd Giai doan 6a doc lai so
  //                 danh bo de xin xac nhan).
  //   "tool"      - ep goi dung 1 tool cu the (dung cho luong xac nhan
  //                 danh bo can 1 function call ro rang).
  // Nem loi ro rang neu thieu tham so bat buoc theo mode - validate
  // TRUOC khi co bat ky side effect nao (chua tang generation, chua gui
  // gi ca) de 1 loi input khong lam hong state hien tai.
  function buildResponsePayload({ mode = "auto", text, instructions, toolChoice } = {}) {
    switch (mode) {
      case "auto":
        return {};
      case "guided":
        if (!instructions) {
          throw new Error('turn-controller: say({mode:"guided"}) can co "instructions"');
        }
        return { instructions };
      case "verbatim":
        if (!text) {
          throw new Error('turn-controller: say({mode:"verbatim"}) can co "text"');
        }
        return {
          instructions: `Doc chinh xac nguyen van cau sau, khong them bot mot chu nao: "${text}"`,
        };
      case "tool":
        if (!toolChoice) {
          throw new Error('turn-controller: say({mode:"tool"}) can co "toolChoice"');
        }
        return { tool_choice: toolChoice };
      default:
        throw new Error(`turn-controller: mode khong hop le: "${mode}"`);
    }
  }

  // API duy nhat de yeu cau bot noi. Tra ve so generation cua yeu cau nay
  // (chu goi co the giu lai de doi chieu sau, khong bat buoc dung).
  function say(opts = {}) {
    // Validate + dung payload TRUOC - neu loi, khong dung gi den state.
    const responsePayload = buildResponsePayload(opts);

    generation += 1;
    const myGeneration = generation;

    // Dang co response nao do chua ket thuc (con trong hang doi cho
    // response-started, HOAC da active) -> huy no truoc khi tao response
    // moi. Neu da biet id that (activeResponseId) thi huy DUNG id do -
    // day la cho sua loi "cancel nham response" cua ban cu (khong doan
    // mo, luon dung id that da luu).
    const responseInFlight = queue.length > 0 || activeResponseId !== null;
    if (responseInFlight) {
      const cancelPayload = { type: "response.cancel" };
      if (activeResponseId) cancelPayload.response_id = activeResponseId;
      send(cancelPayload);

      // Moi thu dang cho trong hang doi hoac dang active tu day bi COI LA
      // DA HUY - response-started/response-ended cua chung (neu con den
      // tre) se duoc nhan dien va khong duoc ghi de state cua generation
      // moi (xem handleSignal).
      for (const entry of queue) entry.cancelled = true;
      activeResponseId = null;
      activeGeneration = null;
    }

    queue.push({ generation: myGeneration, cancelled: false });
    send({ type: "response.create", response: responsePayload });
    return myGeneration;
  }

  // Nhan tin hieu DA CHUAN HOA tu turn-signal.js (khong phai event tho
  // cua OpenAI). Goi ham nay moi khi co tin hieu moi de turn-controller
  // cap nhat dung trang thai dang theo doi.
  function handleSignal(signal) {
    if (!signal || typeof signal.kind !== "string") return;

    if (signal.kind === "response-started") {
      // Ghep voi phan tu O DAU hang doi (FIFO - xem giai thich o khai bao
      // `queue`). Neu phan tu do da bi danh dau cancelled (tu 1 say() sau
      // do), day chinh la tin hieu TRE tu generation cu - bo qua co y,
      // KHONG duoc ghi de activeResponseId cua generation moi. Day la cho
      // fix "retry mo khoa"/"cancel nham response".
      const entry = queue.shift();
      if (!entry) {
        log("warn", `turn-controller: nhan response-started khong ro nguon goc, hang doi rong (responseId=${signal.responseId})`);
        return;
      }
      if (entry.cancelled) {
        log("warn", `turn-controller: bo qua response-started tre tu generation da bi huy (generation=${entry.generation}, responseId=${signal.responseId})`);
        return;
      }
      activeResponseId = signal.responseId;
      activeGeneration = entry.generation;
      return;
    }

    if (signal.kind === "response-ended") {
      // Chi xoa active neu DUNG id dang theo doi. response-ended cua 1
      // response DA BI THAY THE (id khong khop) la BINH THUONG khi minh
      // chu dong huy no - khong phai loi, khong duoc lam mat state cua
      // response MOI dang chay.
      if (signal.responseId !== null && signal.responseId === activeResponseId) {
        activeResponseId = null;
        activeGeneration = null;
      }
      return;
    }
    // Cac kind khac (speech-started, transcript-ready, error, ignored...)
    // khong lien quan toi viec quan ly response.create/cancel - bo qua co y.
  }

  // true neu dang co response chay HOAC dang cho xac nhan (da gui
  // response.create nhung chua biet id/chua ket thuc).
  function isResponseActive() {
    return activeResponseId !== null || queue.length > 0;
  }

  return { say, handleSignal, isResponseActive };
}

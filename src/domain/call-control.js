// src/domain/call-control.js
//
// Giai doan 5b (xem docs/roadmap.md) - port 4 tool dieu khien cuoc goi tu
// ban cu (voice_bot/src/tools.js: handleTransferToAgent,
// handleLeaveCallbackMessage, handleEndCall, handleWaitForUser).
//
// ============================================================================
// CANH BAO KIEN TRUC (doc TRUOC khi noi day that vao dispatch-tool-call.js):
// ============================================================================
// Khac billing.js/outages.js/tickets.js (chi tra DU LIEU de AI doc), 4 tool
// o day co field `action` ("no_reply", "end_call", "transfer_to_agent",
// "leave_message") - ban cu dung field nay de DIEU KHIEN HANH VI CUOC GOI:
//   - wait_for_user -> action:"no_reply": session-ws.js (ban cu) KHONG tao
//     response.create tiep theo - de model im lang thuc su khi am thanh
//     khong huong toi no (tap am/im lang/dang doc do), thay vi bi ep noi.
//   - transfer_to_agent that bai (khong co agent ranh) -> action:
//     "leave_message": chi la 1 GOI Y cho model (doc doc_cho_khach), khong
//     tu dong lam gi ca - model tu quyet dinh buoc tiep theo.
//   - end_call -> action:"end_call": ban cu dung tin hieu nay de biet luc
//     nao dong SIP call THAT sau khi AI noi loi chao tam biet.
//
// [CAP NHAT 25/08/2026, Giai doan 8 - DA XU LY, giu doan van tren de nho
// lich su] dispatch-tool-call.js gio DA doc field `action`: "no_reply" xu ly
// tu Giai doan 5b (bo qua say()); "end_call"/"transfer_to_agent" gio da noi
// vao src/integrations/realtime-calls-api.js THAT (hangupCall/referCall) qua
// 2 tham so factory moi cua createToolDispatcher() - `onEndCall`/
// `onTransferToAgent` - CHI duoc goi SAU KHI da nhan dung tin hieu response-
// ended cua CHINH cau tam biet/thong bao (khong doan bang timer co dinh nhu
// ban cu). Xem chu thich day du trong dispatch-tool-call.js (tim "Giai doan
// 8"). Module NAY (call-control.js) khong doi gi ve mat kien truc - van CHI
// tra du lieu/action, khong tu goi API nao ca, dung ranh gioi da dat ra.
// ============================================================================
//
// GIU NGUYEN nghiep vu THAT khac (khong doan, port dung tu ban cu):
//   - transfer_to_agent: goi getAvailableAgents() VOI TIMEOUT (mac dinh
//     4500ms qua Promise.race) - loi/qua timeout deu duoc BAT LAI, coi nhu
//     "khong co ai ranh" (khong lam sap cuoc goi vi 1 lan goi API cham).
//   - leave_callback_message: ma_danh_bo KHONG BAT BUOC va KHONG qua
//     resolveDanhBoRef/resolveDanhBo (khac 3 file kia) - day la truong
//     THAM KHAO tuy chon tren 1 loi nhan, KHONG phai tra cuu tai khoan (sai
//     1 chu so khong gay lo du lieu nguoi khac nhu tra cuu hoa don) - chi
//     chuan hoa nhe (bo ky tu khong phai so) NEU khach co cung cap, KHONG
//     ep validate/gate. callState.callerPhone (SDT nguoi goi that) duoc
//     dung lam `tel` - he thong tu biet, khong can hoi lai SDT.
//   - end_call/wait_for_user: ham THUAN, khong goi API, tra ve object
//     tinh (gan nhu nguyen van ban cu).
//
// KHAC ban cu (co y, giong 3 file domain truoc): handler tra ve OBJECT
// thuong, KHONG tu JSON.stringify().
export function createCallControlHandlers({ getAvailableAgents, baoSuCo, log = () => {}, transferTimeoutMs = 4500 }) {
  // Chuan hoa NHE ma danh bo cho leave_callback_message - CHI bo ky tu
  // khong phai so, KHONG co fallback doc-chu-so-tieng-Viet nhu
  // normalizeDanhBo() ban cu (thuoc co che thu thap qua VAD cua Giai doan
  // 6, khong lien quan o day - truong nay la THAM KHAO tuy chon, model
  // thuong da tu dien dung chuoi so neu khach co doc).
  function normalizeDanhBoLoose(raw) {
    return String(raw ?? "").replace(/\D/g, "");
  }

  async function handleTransferToAgent({ ly_do } = {}) {
    let availableAgentsResult = null;
    // [fix 23/08/2026, tu phat hien khi viet test - ban cu KHONG co van de
    // nay vi chua tung viet test cho nhanh timeout] Promise.race KHONG tu
    // huy nhanh THUA - neu getAvailableAgents() thang truoc, setTimeout cua
    // nhanh timeout van con song toi khi TU no het han (mac dinh 4500ms),
    // de lai 1 timer "treo" khong lam gi ca nhung van giu event loop song
    // them ~4.5s moi lan goi transfer_to_agent. clearTimeout() trong
    // finally de don du ca 2 nhanh thang/thua.
    let timer;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), transferTimeoutMs);
      });
      availableAgentsResult = await Promise.race([getAvailableAgents(), timeoutPromise]);
    } catch (err) {
      log("warn", `call-control: khong lay duoc trang thai tong dai vien (${err.message}) - coi nhu khong co ai ranh`);
    } finally {
      clearTimeout(timer);
    }

    const { available_agents, queue } = availableAgentsResult?.data || {};
    log("info", `call-control: transfer_to_agent ly_do=${ly_do ?? "?"} available_agents=${available_agents ?? "?"} queue=${queue ?? "?"}`);

    if (available_agents > 0) {
      return {
        success: true,
        action: "transfer_to_agent",
        doc_cho_khach: "Dạ, em xin phép chuyển máy cho tổng đài viên hỗ trợ Quý Khách ngay ạ.",
        message: "Đang chuyển máy cho tổng đài viên, Quý khách vui lòng chờ trong giây lát.",
        ly_do,
        available_agents,
        queue,
      };
    }
    return {
      success: false,
      action: "leave_message",
      doc_cho_khach:
        "Dạ, hiện tại chưa có tổng đài viên nào rảnh để hỗ trợ ạ. Quý Khách có muốn " +
        "để lại lời nhắn để nhân viên liên hệ lại không ạ?",
      message:
        "Không có tổng đài viên khả dụng — đã hỏi khách có muốn để lại lời nhắn không. " +
        "Khách ĐỒNG Ý → hỏi lại nội dung cần nhắn, tóm tắt xác nhận đúng ý, CÓ THỂ hỏi " +
        "thêm mã danh bộ nếu khách có sẵn (KHÔNG bắt buộc, khách không có/không nhớ thì " +
        "bỏ qua, đừng ép đọc) rồi gọi leave_callback_message (KHÔNG dùng create_ticket " +
        "cho trường hợp này — hệ thống tự dùng SĐT cuộc gọi, không cần hỏi SĐT). " +
        "Khách TỪ CHỐI → hỏi khách còn cần hỗ trợ gì khác không, không tự gọi tool nào " +
        "khi khách chưa đồng ý.",
      ly_do,
    };
  }

  async function handleLeaveCallbackMessage({ noi_dung, ma_danh_bo } = {}, callState = {}) {
    const phone = callState.callerPhone || null;
    const maDanhBoChuan = ma_danh_bo ? normalizeDanhBoLoose(ma_danh_bo) : "";
    const r = await baoSuCo(maDanhBoChuan || null, noi_dung || "", phone);
    log("info", `call-control: leave_callback_message ma_danh_bo=${maDanhBoChuan || "(khong co)"} -> success=${r.success}`);

    if (!r.success) {
      return {
        success: false,
        message: r.message || "Không ghi nhận được lời nhắn. Xin lỗi khách, đề nghị khách gọi lại sau ít phút.",
      };
    }
    return {
      success: true,
      doc_cho_khach:
        "Dạ, em đã ghi nhận lời nhắn của Quý Khách rồi ạ. Nhân viên sẽ liên hệ lại " +
        "Quý Khách sớm nhất có thể.",
      message: "Đã ghi nhận lời nhắn thành công.",
      ma_danh_bo: maDanhBoChuan || null,
      data: r.data,
    };
  }

  // [them 25/08/2026, Giai doan 8, chu du an quyet dinh: EP cau kich ban co
  // dinh thay vi de model tu do] Truoc ban sua nay, handleEndCall() KHONG co
  // `doc_cho_khach` (khac han handleTransferToAgent o tren) - dispatch-tool-
  // call.js#sayForOutput() vi vay roi xuong say() mode "auto", de model TU
  // DIEN DAT loi tam biet. Doc lai ban cu (voice_bot/src/session-ws.js,
  // nhanh action==="end_call") xac nhan: ban cu LUON ep 1 cau tam biet CO
  // DINH khi response chua end_call khong sẵn co audio - dung cau CHINH XAC
  // ban cu da dung (thuong hieu, khong doan lai). Gio ep NGAY TU DAU (khong
  // can kiem tra "co san audio chua" nhu ban cu - kien truc moi
  // (dispatch-tool-call.js#sayForOutput) LUON tu goi 1 say() rieng cho MOI
  // tool-call, khong bao gio de model tu ghep loi trong CHINH response chua
  // function_call nhu ban cu tung cho phep, nen khong con truong hop "da co
  // san audio" de kiem tra nua).
  function handleEndCall({ ly_do } = {}) {
    log("info", `call-control: end_call ly_do=${ly_do ?? "(khong co)"}`);
    return {
      success: true,
      action: "end_call",
      doc_cho_khach: "Dạ, em cảm ơn Quý Khách đã gọi đến Tổng đài Công ty Cổ phần Cấp nước Trung An. Kính chào Quý Khách ạ.",
      message: "Kết thúc cuộc gọi.",
      ly_do: ly_do || "Khách hàng đã được hỗ trợ xong",
    };
  }

  function handleWaitForUser() {
    return {
      success: true,
      action: "no_reply",
      message:
        "Âm thanh không cần trả lời (im lặng/tạp âm/không hướng tới Trợ lý). " +
        "KHÔNG nói gì thêm, không gọi tool khác cho lượt này.",
    };
  }

  return { handleTransferToAgent, handleLeaveCallbackMessage, handleEndCall, handleWaitForUser };
}

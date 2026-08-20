# Giai doan 1 - Quan sat luong event that (20/08/2026)

## Muc dich

Truoc khi viet `turn-signal.js`/`turn-controller.js` (Giai doan 2-3), can tu
mat thay thu tu event thuc te tu OpenAI Realtime API - khong doc lai code cu
suy doan. Dung `scripts/probe-realtime.mjs`: mo WebSocket thuan (khong qua
Asterisk/SIP, khong qua business logic), cau hinh giong het "normal mode"
cua production (`semantic_vad`, `eagerness:"low"`, `create_response:true`,
`interrupt_response:true`, transcription `gpt-4o-mini-transcribe`), phat 5
file audio test rieng biet, log toan bo event ra `logs/probe-*.jsonl` + ban
console.log duoc luu lai o `logs/probe-*.txt`.

## Ket qua tung file

**1. `1_hoa_don_tien_nuoc_24k.wav` (5.72s, cau hoi thuong)**
Chuoi event chuan: `speech_started(+3511ms) -> speech_stopped(+7681ms) ->
committed -> conversation.item.added/done -> response.created ->
response.output_audio.delta... -> response.done`. Transcript khop dung
100% cau da doc. Dung lam baseline doi chieu voi cac file sau.

**2. `2_22082351775.wav` (16.88s, doc day so danh bo)**
`speech_started` o +3917ms nhung `speech_stopped`/`committed` chot NGAY o
+5582ms - chi ~1.6 giay audio duoc commit (uoc luong chi khoang 2 so dau).
Transcript tra ve: `"হয় হয়।"` - chu Bengal vo nghia, dau hieu ro rang cua
mot doan audio bi cat qua ngan bi nhan dien sai. Ngay sau do (+6606ms) co
`speech_started` LAN HAI (khach van dang doc tiep) nhung script dong ket
noi sau `response.done` dau tien nen khong bat duoc phan con lai.

=> TAI HIEN DUNG loai loi ma `session-ws.js` ban cu tung vo hang chuc lan
("model doc so bay ra khong dung, VAD cat mat so giua chung" - xem comment
[MUC C - dot 5] trong file do). Day la bang chung THAT, tu tay tao ra
duoc, khong con la suy doan tu log san xuat nua.

**3. `3_ngap_ngung.wav` (16.44s, cung day so nhung co ngap ngung dau cau)**
`speech_started` o +3215ms, `speech_stopped` DOI toi +17857ms (~14.6 giay
audio lien tuc). Transcript ve DUNG NGUYEN VAN: `"À, để anh xem, số danh
bộ là 2208-2351-775"`.

=> Cung mot day so, cung co yeu to "ngap ngung", nhung LAN NAY VAD khong
cat giua chung. Gia thuyet: KHONG PHAI su ngap ngung lam VAD cat som, ma
la KHOANG NGUNG THAT (im lang) giua cac cum so. File 3 co the da doc lien
mach (ke ca phan "À để anh xem" cung la loi noi lien tuc, khong phai im
lang), con file 2 nhieu kha nang co nhung khoang dung giua cac cum so du
dai de `semantic_vad (eagerness:low)` coi la het luot.

CAN XAC NHAN LAI voi nguoi ghi am: luc doc file 2, co dung han (im lang)
giua cac cum so hay doc lien mot hoi? Day se la du lieu nen tang de thiet
ke `turn_detection` cho `call-flow/danh-bo-collect.js` (Giai doan 6).

**4. `4_tap_am.wav` (5.85s, tap am nen, khong noi gi)**
Khong co `speech_started` nao xuat hien trong suot ~5.85s phat + 1.5s im
lang them vao - phai Ctrl+C moi thoat duoc (script chua co timeout khi
khong phat hien luot noi nao - han che cua `probe-realtime.mjs`, khong
phai hanh vi VAD). Tin tot: o `eagerness:"low"`, tap am nen KHONG kich
hoat nham `speech_started` trong lan thu nay.

**5. Smoke test bang text (khong audio)**
Chay dung nhu thiet ke, xac nhan ket noi/cau hinh session hoat dong tot
truoc khi thu audio that.

## Phat hien quan trong nhat: transcript ve SAU khi response da bat dau

O ca file 2 va file 3, event `conversation.item.input_audio_transcription
.completed` den SAU `response.created` va XEN GIUA cac
`response.output_audio.delta` - tuc la model da bat dau tao cau tra loi
(dua tren audio tho no tu nghe) TRUOC KHI transcript text ma minh doc duoc
kip xuat hien.

=> Xac nhan bang THUC NGHIEM dieu da ghi trong project memory
(`voicebot-transcript-debug-only.md`): transcript CHI de debug, KHONG phai
thu model dung de quyet dinh - model quyet dinh dua tren audio tho no tu
nghe, transcript la mot luong song song CHAM HON, chi de code (va nguoi)
quan sat.

## Ket luan / viec can lam tiep

1. Xac nhan lai voi nguoi ghi am ve cach doc file 2 (dung han giua cac
   cum so hay khong) - se quyet dinh cach dien giai gia thuyet o tren.
2. Khi thiet ke `call-flow/danh-bo-collect.js` (Giai doan 6): khong the
   dua vao `semantic_vad` mac dinh cho giai doan doc so - dung y het ly
   do ban cu da chuyen sang `create_response:false` ("locked mode") cho
   giai doan nay. Gio da co bang chung tu tay tai hien, khong con la
   "nghe noi vay".
3. `probe-realtime.mjs` can them timeout an toan (vd 20s khong co
   `speech_started` thi tu dong` -> chua sua, dang cho quyet dinh co lam
   luon o Giai doan 1 hay de sau.
4. Diem 2 (transcript den sau response.created) can duoc phan anh vao
   thiet ke `turn-signal.js` (Giai doan 2): module nay KHONG duoc dung de
   quyet dinh "model co nen noi khong" (qua muon, response da chay roi) -
   chi dung de LOG/quan sat va cho cac quyet dinh KHONG lien quan toi tao
   response (vd dem so, phat hien tu khoa xac nhan/phu dinh sau khi
   response da xong).

## Du lieu goc

`logs/probe-*.jsonl` (khong commit len git - da chan trong `.gitignore`).

## Dinh chinh (bo sung sau khi trao doi voi nguoi ghi am)

Gia thuyet "khoang ngung giua cac cum so" o tren CHUA DU CAN CU. Nguoi ghi
am cho biet: file 2 co tap am o DOAN CUOI, file 3 KHONG co tap am. Hai file
dang khac nhau o NHIEU bien cung luc (co/khong tap am, co/khong cau dan "A
de anh xem", co the ca cach ngat nhip doc so) - khong tach duoc bien nao
la nguyen nhan that su.

Luu y: tap am o doan cuoi file 2 (16.88s) kho giai thich duoc lan cat som
o +5582ms (chi ~1.6s sau khi bat dau noi) - qua xa thoi diem tap am cuoi
file. Nen tap am cuoi file kho la thu pham TRUC TIEP cua lan cat som do,
nhung van co the la mot bien gay nhieu khac (vd anh huong toi
`speech_started` lan hai o +6606ms).

=> CAN TEST LAI voi bien duoc tach rieng - 3 file moi, moi file chi doi
DUNG MOT bien so voi baseline:
- `5_so_lien_mach_sach.wav`: doc mot day so (bia) LIEN MACH, phong yen
  tinh, khong cau dan.
- `6_so_ngat_quang_sach.wav`: CUNG day so do, dung ~0.7-1s giua moi cum
  2-3 so, phong yen tinh, khong cau dan. (So sanh truc tiep voi file 5 -
  chi khac dung mot bien: co/khong khoang ngung.)
- `7_so_lien_mach_co_tap_am.wav`: doc lien mach nhu file 5, nhung co tap
  am nen suot luc ghi. (Tach rieng anh huong cua tap am khoi khoang
  ngung.)

Chua chay - dang cho nguoi ghi am chuan bi 3 file nay.

## Cap nhat 20/08/2026 (2): doi transcription model

Ap dung thay doi transcription config (`scripts/probe-realtime.mjs`):
`gpt-4o-mini-transcribe` -> `gpt-4o-transcribe`, them `language: "vi"` +
`prompt` ngu canh domain (dung y het doan config ma du an ban cu da dung
cho SIP, co ly do rieng - xem comment trong file).

QUAN TRONG: thay doi nay CHI nam trong `audio.input.transcription`, HOAN
TOAN TACH BIET khoi `audio.input.turn_detection` (VAD). Dung tinh than
phat hien o tren (transcript chi de debug, khong anh huong luc model
quyet dinh noi) - doi transcription model KHONG lam thay doi thoi diem
`speech_started`/`speech_stopped`/`committed`/`response.created`.

=> KHONG can chay lai 3 file kiem chung VAD (5/6/7) vi doi nay. Nhung NEN
chay lai dung file `2_22082351775.wav` (file da cho transcript vo nghia
"হয় হয়।") voi config moi, xem \`gpt-4o-transcribe\`
+ \`language:"vi"\` + prompt domain co sua duoc loi phien am sai ngon ngu
do hay khong - day la mot truc quan sat khac (chat luong transcript),
doc lap voi truc VAD-cat-som o tren.

## Ket luan cuoi cung (20/08/2026, sau khi test lai co kiem soat bien)

Da chay 7 file: `2_22082351775.wav` (doc lai, model transcription moi),
`6_ngap_ngung.wav`, va 5 file `..._lienmach_noise{1..5}.wav` (doc lien mach
+ tap am o cac muc do khac nhau). Ket qua (so goc `22082351775`, 11 chu so):

| File | Kieu doc | Tap am | Bi cat som? | Transcript |
| --- | --- | --- | --- | --- |
| `2_22082351775.wav` | co khoang ngung | khong | CO (+5506ms, ~1.7s) | "Hai hai" |
| `6_ngap_ngung.wav` | ngap ngung, co ngung | khong | CO (+4919ms, ~2.5s) | "202002" |
| `..._lienmach_noise1.wav` | lien mach | co | Khong (+9972ms, tron ven) | "2202 3251 775." |
| `..._lienmach_noise2.wav` | lien mach | co | Khong (+10227ms, tron ven) | "2202 3251 7755" |
| `..._lienmach_noise3.wav` | lien mach | co | Khong (+10182ms, tron ven) | "2202 3251 7755" |
| `..._lienmach_noise4.wav` | lien mach | co (on hon?) | Cat gan cuoi + response bi cancel | "22020325077575" (garbled) |
| `..._lienmach_noise5.wav` | lien mach | co (on nhat?) | VAD KHONG nhan ra loi noi - phai Ctrl+C | (khong co) |

KET LUAN: dung nhu gia thuyet ban dau - KHOANG NGUNG GIUA CAC CUM SO la
nguyen nhan khien `semantic_vad (eagerness:low)` cat som, KHONG PHAI tap
am (3/5 file co tap am van doi tron ven het cau). Doi transcription model
(`gpt-4o-transcribe`) KHONG sua duoc viec cat som (dung du doan - day la
hai co che doc lap), nhung CO sua duoc trieu chung "chu la vo nghia":
transcript cua doan bi cat lan nay la "Hai hai" (dung tieng Viet) thay vi
"হয় হয়।" (chu Bengal) nhu truoc khi doi model.

PHAT HIEN PHU: file `noise5` lo ra loi NGUOC LAI - tap am qua lon khien
VAD khong nhan ra co nguoi dang noi, bot se im lang vo thoi han neu khong
co luoi an toan. Day la ly do watchdog (Giai doan 7) khong the bo qua.

PHAT HIEN PHU 2: moi lan VAD cat som, he thong sinh `response.created`
roi gan nhu ngay sau do bi `response.done status="cancelled"` (do
`interrupt_response:true` phat hien khach van dang noi tiep) - co che
ngat hoat dong dung thiet ke, nhung trong luong doc so that se nghe nhu
bot bi "giat" giua chung.

=> AP DUNG CHO GIAI DOAN 6 (`call-flow/danh-bo-collect.js`): khong the
dung `semantic_vad` (du eagerness thap) cho giai doan doc so - can
`create_response:false` (locked mode, dung y het huong ban cu) VI khach
hang thuc te se dung giua cac cum so (hoan toan tu nhien khi doc day 11
chu so), va thi nghiem nay chung minh VAD khong the doi qua nhung khoang
dung do mot cach dang tin cay du eagerness da la muc thap nhat.

## So sanh model: gpt-realtime-2.1-mini vs gpt-realtime-2.1 (20/08/2026)

Chay lai TOAN BO cac file test (1, 2, 2_lienmach + noise1-5, 3, 4, 6) voi
`OPENAI_REALTIME_MODEL=gpt-realtime-2.1` (ban day du, thay vi mini) - chi
doi bien moi truong, khong sua code (script da doc model tu env san).

| File | mini - cat som? | day du - cat som? |
| --- | --- | --- |
| `1_hoa_don...wav` | Khong, tron ven | Khong, tron ven |
| `2_22082351775.wav` (co khoang ngung) | CO (+5506ms) -> "Hai hai" | CO, con som hon (+4805ms) -> "Hai hai" |
| `2_..._lienmach.wav` (lien mach, sach - file moi) | (chua test voi mini) | CAT NHE (+7359ms, thieu ~1s cuoi) -> "2202 3251 77" (thieu so cuoi) |
| `2_..._lienmach_noise1/2/3.wav` | Khong, tron ven ca 3 | Khong, tron ven ca 3 (transcript chinh xac hon mot chut) |
| `2_..._lienmach_noise4.wav` | Cat gan cuoi + cancel | Cat gan cuoi + cancel (giong het pattern) |
| `2_..._lienmach_noise5.wav` (on nang) | VAD khong nhan ra loi noi | VAD khong nhan ra loi noi (giong het) |
| `3_ngap_ngung.wav` | Khong, tron ven | Khong, tron ven |
| `4_tap_am.wav` | Khong kich hoat (dung) | Khong kich hoat (dung) |
| `6_ngap_ngung.wav` (co ngung) | CO (+4919ms) -> "202002" | CO (+4798ms) -> "2022022" |

KET LUAN: doi sang `gpt-realtime-2.1` (ban day du) KHONG giai quyet duoc
van de cat som. Ca hai file "kho" (co khoang ngung that) van bi cat o CA
HAI model - ban day du con cat file 2 SOM HON mot chut (4805ms so voi
5506ms cua mini). Dang chu y hon: file `lienmach.wav` moi (doc lien mach,
sach, khong tap am) - kich ban le ra "de" nhat - cung bi cat mat so cuoi
voi ban day du.

=> Cung co them (khong lam lung lay) ket luan truoc: khong the tin
`semantic_vad` (du model nao) se luon doi dung ranh gioi luot noi khi co
khoang ngung tu nhien trong loi noi - day la gioi han cua co che VAD ngu
nghia, KHONG PHAI gioi han rieng cua ban mini. Quyet dinh dung
`create_response:false` cho giai doan thu so o Giai doan 6 gio co them
mot lop bang chung nua, DOC LAP voi viec chon model nao cho phan con lai
cua bot - khong can doi model rieng cho giai doan nay.

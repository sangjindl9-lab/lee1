// 처음 실행할 때 한 번만 넣는 기본 데이터 (첨부한 10/16 발주서 기준)
const ssjr = { kind: "buyer", name: "㈜ 에스에스전력", bizNo: "220-86-60440", ceo: "김세인", addr: "강원 원주 소초면 하초구길 60", bizType: "도,소매업", bizItem: "전기자재 외", place: "㈜에스에스전력", placeManager: "김동신부장(010-2621-4109)", stamp: "", signature: "" };
const gabo = { kind: "supplier", name: "㈜가보테크", manager: "김준호이사(010-5818-0423)", phone: "031) 752-0272", fax: "031) 752-0273" };
const kim = { kind: "staff", name: "김동신", title: "부장", phone: "010-2621-4109", signature: "" };
export const SEED = {
  vendors: [ { id: "vssjr", ...ssjr }, { id: "vgabo", ...gabo }, { id: "s-kimds", ...kim } ],
  materials: [ { name: "단자대", spec: "누전차단기1개내장형", unit: "SET", price: "", note: "가로등용접속함" } ],
  orders: [ {
    id: "o261016", site: "홍천국도 관내 북부권역 전기시설물 유지보수 공사", date: "2026-10-16",
    buyerId: "vssjr", buyer: { id: "vssjr", ...ssjr }, staffId: "s-kimds", staff: { id: "s-kimds", ...kim },
    vendorId: "vgabo", vendor: { id: "vgabo", ...gabo },
    due: "", payment: "", special: "", place: "㈜에스에스전력", placeManager: "김동신부장(010-2621-4109)", inspect: {},
    items: [ { name: "단자대", spec: "누전차단기1개내장형", unit: "SET", qty: "50", price: "", note: "가로등용접속함" } ],
    savedAt: "2026-10-16T09:00:00+09:00",
  } ],
};

// A Google Maps list as the getlist endpoint answers it, shaped like a real
// one (2026-10-05) but made up: no real account, ids or notes. Used by
// test/travel.test.js, test/bridge.test.js and test/browser/travelmap.js.
// Each place is [null, [null, null, "", null, address, [null, null, lat, lng],
// [id1, id2] as signed decimals], name, note, …, owner]; the list is
// [[id, …], …, owner, name, …, places at [8]].
const OWNER = ["Someone", "https://example.invalid/avatar.png", "100000000000000000001"];
const PLACES = [
  ["Colosseo", 41.8902, 12.4922, "", "Book the underground tour", ["1382429461813212457", "-1660451460868083087"]],
  ["Pantheon", 41.8986, 12.4769, "", "", ["1382429411558486361", "9120884825938768253"]],
  ["Trevi", 41.9009, 12.4833, "", "", ["1382429400000000001", "-1"]],
  ["Duomo di Milano", 45.4642, 9.1916, "P.za del Duomo, 20122 Milano MI, Italy", "", ["1384000000000000001", "42"]],
  ["Sforzesco Castle", 45.4705, 9.1795, "Piazza Castello, 20121 Milano MI, Italy", "Free on Tuesdays", ["1384000000000000002", "43"]],
];
const LIST_ID = "TestList0000000000000001";
function googleList(places = PLACES, name = "Italy") {
  const rows = places.map(([n, lat, lng, address, note, ids]) => [
    null, [null, null, "", null, address, [null, null, lat, lng], ids], n, note,
    null, null, null, [], [[1], ids], [1767210739, 645402000], [1767210739, 645402000], null, OWNER,
  ]);
  const root = [[[LIST_ID, 1, null, 1, 1], 1, [2, 1, "https://www.google.com/maps/placelists/list/" + LIST_ID], OWNER, name, "", null, null, rows, [], [], [], rows.length]];
  return ")]}'\n" + JSON.stringify(root);
}
module.exports = { googleList, LIST_ID, PLACES };

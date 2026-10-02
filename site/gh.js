/* 透過 GitHub API 讀寫 repo 裡的 JSON 檔（持倉、觀察清單共用）。
 * 權杖存在這台裝置的瀏覽器（localStorage），只給這個 repo 的 Contents 讀寫。 */
(function () {
  "use strict";
  var onPages = location.hostname.endsWith(".github.io");
  var REPO = onPages ? location.hostname.split(".")[0] + "/" + location.pathname.split("/")[1] : "BeckWang888/cheap-dashboard";

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function token() { return ls("cd_gh_token") || ""; }
  function headers() { var h = { "Accept": "application/vnd.github+json" }; if (token()) h.Authorization = "Bearer " + token(); return h; }
  function b64decode(s) { var bin = atob(s.replace(/\n/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
  function b64encode(str) { var u = new TextEncoder().encode(str), bin = ""; for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]); return btoa(bin); }
  function url(path) { return "https://api.github.com/repos/" + REPO + "/contents/" + path; }

  /** 讀檔，回傳 {data, sha}。本機預覽直接讀 repo 裡的檔案。 */
  function get(path) {
    if (!onPages) {
      return fetch("../" + path + "?t=" + Date.now()).then(function (r) { return r.json(); }).then(function (j) { return { data: j, sha: "local" }; });
    }
    return fetch(url(path) + "?ref=main&t=" + Date.now(), { headers: headers(), cache: "no-store" }).then(function (r) {
      if (r.status === 401) throw new Error("存取權杖無效或已過期，請到持倉頁的「存檔設定」重新貼上");
      if (!r.ok) throw new Error("讀取 " + path + " 失敗（" + r.status + "）");
      return r.json();
    }).then(function (j) { return { data: JSON.parse(b64decode(j.content)), sha: j.sha }; });
  }

  /** 寫檔，回傳新的 sha。sha 不符（別的裝置剛改過）時丟出 conflict 錯誤。 */
  function put(path, data, sha, message) {
    if (!onPages) return Promise.reject(new Error("本機預覽不能存檔"));
    var body = { message: message, content: b64encode(JSON.stringify(data, null, 1) + "\n"), sha: sha, branch: "main" };
    return fetch(url(path), { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers()), body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 409 || r.status === 422) { var e = new Error("這個檔案在別的裝置剛被改過，已重新載入，請再操作一次"); e.conflict = true; throw e; }
        if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error("存檔被拒絕：存取權杖沒有這個 repo 的寫入權限");
        if (!r.ok) throw new Error("存檔失敗（" + r.status + "）");
        return r.json();
      }).then(function (j) { return j.content.sha; });
  }

  /** 測試權杖是否能寫入這個 repo。 */
  function canWrite() {
    return fetch("https://api.github.com/repos/" + REPO, { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.permissions && j.permissions.push); });
  }

  window.GH = { REPO: REPO, ls: ls, token: token, get: get, put: put, canWrite: canWrite };
})();

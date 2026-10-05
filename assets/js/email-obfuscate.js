(function () {
  // Requires a real click (not just JS execution) to ever place the plain
  // address in the DOM, so page-scraping bots that render JS on load still
  // don't harvest it automatically.
  document.querySelectorAll(".contact-obfuscated").forEach(function (el) {
    var user = el.getAttribute("data-user");
    var domain = el.getAttribute("data-domain");
    if (!user || !domain) return;
    var linkClass = el.getAttribute("data-link-class") || "";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "email-reveal " + linkClass;
    btn.textContent = "Show email";
    btn.addEventListener("click", function () {
      var address = user + "@" + domain;
      var link = document.createElement("a");
      link.href = "mailto:" + address;
      link.textContent = address;
      link.className = linkClass;
      btn.replaceWith(link);
    });
    el.replaceWith(btn);
  });
})();

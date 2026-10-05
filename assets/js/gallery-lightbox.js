(function () {
  var masonry = document.querySelector(".masonry");
  if (!masonry) return;

  // ---- Filters -------------------------------------------------------
  var filters = document.querySelectorAll(".gfilter");
  var items = Array.prototype.slice.call(masonry.querySelectorAll(".gitem"));

  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var f = btn.getAttribute("data-filter");
      items.forEach(function (item) {
        var show = f === "all" || item.getAttribute("data-type") === f;
        item.classList.toggle("is-hidden", !show);
      });
    });
  });

  // ---- Lightbox (photos) ---------------------------------------------
  var photoFrames = Array.prototype.slice.call(masonry.querySelectorAll(".gframe:not(.is-video)"));

  if (photoFrames.length) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.innerHTML =
      '<div class="lightbox-stage">' +
      '<img alt="">' +
      '<div class="lightbox-caption"><b></b><span></span></div>' +
      "</div>" +
      '<button class="lightbox-zoom-hint" type="button">Click image to zoom</button>' +
      '<button class="lightbox-close" type="button" aria-label="Close">&#10005;</button>' +
      '<button class="lightbox-prev" type="button" aria-label="Previous">&#10094;</button>' +
      '<button class="lightbox-next" type="button" aria-label="Next">&#10095;</button>';
    document.body.appendChild(lb);

    var stage = lb.querySelector(".lightbox-stage");
    var img = lb.querySelector("img");
    var capTitle = lb.querySelector(".lightbox-caption b");
    var capText = lb.querySelector(".lightbox-caption span");
    var current = 0;
    var zoomed = false;
    var pan = { x: 0, y: 0 };
    var drag = null;

    function resetZoom() {
      zoomed = false;
      pan = { x: 0, y: 0 };
      stage.classList.remove("is-zoomed");
      img.style.transform = "";
    }

    function show(index) {
      current = (index + photoFrames.length) % photoFrames.length;
      var frame = photoFrames[current];
      img.src = frame.getAttribute("data-full");
      img.alt = frame.getAttribute("data-title") || "";
      capTitle.textContent = frame.getAttribute("data-title") || "";
      capText.textContent = frame.getAttribute("data-caption") || "";
      resetZoom();
    }

    function open(index) {
      show(index);
      lb.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }

    function close() {
      lb.classList.remove("is-open");
      document.body.style.overflow = "";
      resetZoom();
    }

    photoFrames.forEach(function (frame, i) {
      frame.addEventListener("click", function () { open(i); });
    });

    lb.querySelector(".lightbox-close").addEventListener("click", close);
    lb.querySelector(".lightbox-prev").addEventListener("click", function () { show(current - 1); });
    lb.querySelector(".lightbox-next").addEventListener("click", function () { show(current + 1); });

    lb.addEventListener("click", function (e) {
      if (e.target === lb) close();
    });

    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(current - 1);
      if (e.key === "ArrowRight") show(current + 1);
    });

    img.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!zoomed) {
        zoomed = true;
        stage.classList.add("is-zoomed");
        img.style.transform = "scale(2.2)";
      } else {
        resetZoom();
      }
    });

    function pointerDown(e) {
      if (!zoomed) return;
      var p = e.touches ? e.touches[0] : e;
      drag = { startX: p.clientX, startY: p.clientY, panX: pan.x, panY: pan.y };
      stage.classList.add("is-dragging");
    }
    function pointerMove(e) {
      if (!drag) return;
      var p = e.touches ? e.touches[0] : e;
      pan.x = drag.panX + (p.clientX - drag.startX);
      pan.y = drag.panY + (p.clientY - drag.startY);
      img.style.transform = "scale(2.2) translate(" + pan.x / 2.2 + "px, " + pan.y / 2.2 + "px)";
      if (e.cancelable) e.preventDefault();
    }
    function pointerUp() {
      drag = null;
      stage.classList.remove("is-dragging");
    }
    stage.addEventListener("mousedown", pointerDown);
    stage.addEventListener("touchstart", pointerDown, { passive: true });
    window.addEventListener("mousemove", pointerMove);
    window.addEventListener("touchmove", pointerMove, { passive: false });
    window.addEventListener("mouseup", pointerUp);
    window.addEventListener("touchend", pointerUp);
  }

  // ---- Video modal -----------------------------------------------------
  var videoFrames = Array.prototype.slice.call(masonry.querySelectorAll(".gframe.is-video"));

  if (videoFrames.length) {
    var vm = document.createElement("div");
    vm.className = "video-modal";
    vm.setAttribute("role", "dialog");
    vm.setAttribute("aria-modal", "true");
    vm.innerHTML =
      '<div class="video-modal-stage"></div>' +
      '<button class="video-modal-close" type="button" aria-label="Close">&#10005;</button>';
    document.body.appendChild(vm);
    var vmStage = vm.querySelector(".video-modal-stage");

    function closeVideo() {
      vm.classList.remove("is-open");
      vmStage.innerHTML = "";
      document.body.style.overflow = "";
    }

    videoFrames.forEach(function (frame) {
      frame.addEventListener("click", function () {
        var yt = frame.getAttribute("data-youtube");
        var src = frame.getAttribute("data-video-src");
        vmStage.innerHTML = yt
          ? '<iframe src="https://www.youtube-nocookie.com/embed/' + yt + '?autoplay=1&rel=0" ' +
            'title="' + (frame.getAttribute("data-title") || "Video") + '" ' +
            'allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>'
          : '<video src="' + src + '" controls autoplay playsinline></video>';
        vm.classList.add("is-open");
        document.body.style.overflow = "hidden";
      });
    });

    vm.querySelector(".video-modal-close").addEventListener("click", closeVideo);
    vm.addEventListener("click", function (e) { if (e.target === vm) closeVideo(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && vm.classList.contains("is-open")) closeVideo();
    });
  }
})();

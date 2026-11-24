// The prototype's only script: it switches the theme, the width shown and the states, replays
// the motion, and draws what every page repeats (the toolbar, the sidebar, the tab bar). It
// holds no design: the CSS does.

const icon = (name, size) => '<span class="i i-' + name + (size ? " " + size : "") + '" aria-hidden="true"></span>';

const statusbar = (bar) => {
  bar.innerHTML = '<span class="num">9:41</span><span class="dots"><span></span><span></span></span>';
};

// A sheet, a dialog or a menu: `data-open="true|false"` on its container; the CSS moves it.
const setOpen = (target, open) => {
  document.querySelectorAll(target).forEach((element) => {
    element.dataset.open = String(open);
  });
};

// Contrast, measured in the browser from the colours as they resolve (scale page): the WCAG
// ratio of `data-fg` on `data-bg`, two sample elements.
const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

const fromOklab = (L, a, b) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

// A block, not a function: what is declared here stays out of the pages' own scripts.
{
  const root = document.documentElement;

  const store = {
    get: (key, fallback) => {
      try {
        return localStorage.getItem("proto-" + key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem("proto-" + key, value);
      } catch {
        // file:// in some browsers: the choice lasts for this page only.
      }
    },
  };

  const apply = () => {
    root.dataset.colorScheme = store.get("scheme", "light");
    root.dataset.view = store.get("view", "desktop");
    root.dataset.notes = store.get("notes", "shown");
    root.dataset.reducedMotion = store.get("motion", "off");
    document.querySelectorAll("[data-set]").forEach((button) => {
      const [key, value] = button.dataset.set.split(":");
      button.setAttribute("aria-pressed", String(store.get(key, defaults[key]) === value));
    });
    fit();
  };

  const defaults = { scheme: "light", view: "desktop", notes: "shown", motion: "off" };

  // The desktop frame is 1280 px wide: shrink it to the canvas, never grow it.
  const fit = () => {
    const canvas = document.querySelector(".canvas");

    if (!canvas) {
      return;
    }

    const room = canvas.clientWidth - 48;
    root.style.setProperty("--fit", String(Math.min(1, room / 1282)));

    const desktops = document.querySelectorAll(".device.desktop").length;
    const phones = document.querySelectorAll(".device.phone").length;
    const row = desktops * (1282 + 24) + phones * (402 + 24) - 24;
    // A few pixels to spare, so that rounding never sends the last phone to the next row.
    root.style.setProperty("--fit-both", String(Math.min(1, room / (row + 8))));
  };

  const LOGO =
    '<svg viewBox="20 20 698.7 160" role="img" aria-label="Gousset"><path class="stroke" d="M166.0 100.0 A 66 66 0 1 1 142.4 49.4" stroke-width="28" stroke-linecap="round" fill="none"/><circle class="ink" cx="118" cy="100" r="20"/><path class="ink" d="M266.1 147.36Q251.5 147.36 240.88 141.54Q230.26 135.71 224.5 125.15Q218.74 114.59 218.74 100.38Q218.74 86.18 224.5 75.49Q230.26 64.8 240.5 58.72Q250.74 52.64 264.3 52.64Q275.31 52.64 284.08 56.67Q292.85 60.7 298.29 67.68Q303.73 74.66 304.88 83.87H288.24Q286.96 75.68 280.56 70.94Q274.16 66.21 264.56 66.21Q255.86 66.21 249.33 70.3Q242.8 74.4 239.22 81.950Q235.63 89.5 235.63 100Q235.63 110.75 239.28 118.37Q242.93 125.98 249.9 129.95Q256.88 133.92 266.99 133.92Q274.8 133.92 280.43 131.94Q286.06 129.95 289.52 125.98L305.52 132.26Q298.22 139.68 288.62 143.52Q279.02 147.36 266.1 147.36ZM288.88 132.26V105.38L292.85 109.34H266.86V96.29H305.52V132.26ZM350.32 147.36Q339.95 147.36 332.08 143.01Q324.21 138.66 319.86 130.91Q315.5 123.17 315.5 113.18Q315.5 103.2 319.86 95.65Q324.21 88.1 332.08 83.81Q339.95 79.52 350.32 79.52Q360.82 79.52 368.62 83.81Q376.43 88.1 380.78 95.65Q385.14 103.2 385.14 113.18Q385.14 123.17 380.72 130.91Q376.3 138.66 368.5 143.01Q360.69 147.36 350.32 147.36ZM350.32 134.43Q355.44 134.43 359.54 131.81Q363.63 129.18 365.94 124.38Q368.24 119.58 368.24 113.06Q368.24 103.46 363.18 97.95Q358.13 92.45 350.32 92.45Q342.51 92.45 337.39 97.95Q332.27 103.46 332.27 113.06Q332.27 119.58 334.64 124.38Q337.01 129.18 341.04 131.81Q345.07 134.43 350.32 134.43ZM418.16 147.36Q411.38 147.36 406.45 144.48Q401.52 141.6 398.9 136.61Q396.27 131.62 396.27 125.34V80.8H412.4V122.02Q412.4 128.03 415.41 131.1Q418.42 134.18 423.92 134.18Q428.91 134.18 432.69 131.87Q436.46 129.57 438.7 125.41Q440.94 121.25 440.94 116L442.61 131.62Q439.41 138.78 433.07 143.07Q426.74 147.36 418.16 147.36ZM441.46 146.08V130.72H440.94V80.8H457.2V146.08ZM498.67 147.36Q485.1 147.36 477.04 141.66Q468.98 135.97 468.21 125.86H482.93Q483.57 130.85 487.66 133.41Q491.76 135.97 498.67 135.97Q504.94 135.97 508.08 133.98Q511.22 132 511.22 128.29Q511.22 125.6 509.42 123.87Q507.63 122.14 502.64 120.99L492.14 118.56Q481.39 116.26 476.21 111.33Q471.02 106.4 471.02 98.98Q471.02 89.89 478 84.7Q484.98 79.52 497.26 79.52Q509.42 79.52 516.78 84.7Q524.14 89.89 524.91 98.98H510.19Q509.55 95.01 506.16 92.96Q502.77 90.91 496.88 90.91Q491.38 90.91 488.56 92.64Q485.74 94.37 485.74 97.7Q485.74 100.26 487.92 101.98Q490.1 103.71 495.22 104.99L506.48 107.55Q516.08 109.73 521.01 115.1Q525.94 120.48 525.94 127.78Q525.94 137.12 518.77 142.24Q511.6 147.36 498.67 147.36ZM563.06 147.36Q549.49 147.36 541.42 141.66Q533.36 135.97 532.59 125.86H547.31Q547.95 130.85 552.05 133.41Q556.14 135.97 563.06 135.97Q569.33 135.97 572.46 133.98Q575.6 132 575.6 128.29Q575.6 125.6 573.81 123.87Q572.02 122.14 567.02 120.99L556.53 118.56Q545.78 116.26 540.59 111.33Q535.41 106.4 535.41 98.98Q535.41 89.89 542.38 84.7Q549.36 79.52 561.65 79.52Q573.81 79.52 581.17 84.7Q588.53 89.89 589.3 98.98H574.58Q573.94 95.01 570.54 92.96Q567.15 90.91 561.26 90.91Q555.76 90.91 552.94 92.64Q550.13 94.37 550.13 97.7Q550.13 100.26 552.3 101.98Q554.48 103.71 559.6 104.99L570.86 107.55Q580.46 109.73 585.39 115.1Q590.32 120.48 590.32 127.78Q590.32 137.12 583.15 142.24Q575.98 147.36 563.06 147.36ZM632.94 147.36Q622.58 147.36 614.83 143.01Q607.09 138.66 602.8 130.98Q598.51 123.3 598.51 113.31Q598.51 103.33 602.8 95.71Q607.09 88.1 614.77 83.81Q622.45 79.52 632.69 79.52Q642.42 79.52 649.58 83.55Q656.75 87.58 660.72 94.88Q664.69 102.18 664.69 111.9Q664.69 113.7 664.56 115.23Q664.43 116.77 664.18 118.3H608.5V107.04H651.76L648.43 110.11Q648.43 100.9 644.21 96.29Q639.98 91.68 632.43 91.68Q624.24 91.68 619.44 97.31Q614.64 102.94 614.64 113.57Q614.64 124.06 619.44 129.63Q624.24 135.2 633.07 135.2Q638.19 135.2 642.03 133.28Q645.87 131.36 647.66 127.39H662.9Q659.7 136.61 652.08 141.98Q644.46 147.36 632.94 147.36ZM704.62 147.36Q692.59 147.36 686.9 141.66Q681.2 135.97 681.2 124.58V65.95L697.46 59.94V124.96Q697.46 129.7 700.02 132Q702.58 134.3 708.08 134.3Q710.26 134.3 711.98 133.98Q713.71 133.66 715.25 133.15V145.7Q713.71 146.46 710.9 146.91Q708.08 147.36 704.62 147.36ZM668.66 93.47V80.8H715.25V93.47Z"/></svg>';

  const SCREENS = [
    ["review", "chart-donut", "Review"],
    ["operations", "list-details", "Operations"],
    ["accounts", "building-bank", "Accounts"],
    ["investments", "chart-line", "Investments"],
    ["subjects", "tags", "Subjects"],
    ["import", "file-import", "Import"],
  ];

  const sidebar = (aside) => {
    const current = aside.dataset.current;

    const links = SCREENS.map(
      ([id, glyph, label]) =>
        '<a class="nav-link" href="#"' + (id === current ? ' aria-current="page"' : "") + ">" + icon(glyph, "lg") + "<span>" + label + "</span></a>",
    ).join("");

    aside.innerHTML =
      '<div class="brand">' + LOGO + "</div>" +
      '<nav class="nav" aria-label="Main">' + links + "</nav>" +
      '<div class="nav-foot">' +
      '<a class="nav-link" href="#"' + (current === "settings" ? ' aria-current="page"' : "") + ">" + icon("settings", "lg") + "<span>Settings</span></a>" +
      '<button class="user-button" type="button" aria-haspopup="menu" aria-expanded="' + (aside.dataset.menu === "open") + '"><span class="avatar sm">AM</span><span class="truncate t-strong">Alex Martin</span>' + icon("selector") + "</button>" +
      "</div>";
  };

  const tabbar = (nav) => {
    const current = nav.dataset.current;

    const tabs = [
      ["review", "chart-donut", "Review"],
      ["operations", "list-details", "Operations"],
      ["accounts", "building-bank", "Accounts"],
      ["more", "dots", "More"],
    ];

    nav.innerHTML = tabs
      .map(([id, glyph, label]) => '<a class="tab" href="#"' + (id === current ? ' aria-current="page"' : "") + ">" + icon(glyph, "lg") + "<span>" + label + "</span></a>")
      .join("");
  };

  const toolbar = (bar) => {
    bar.innerHTML =
      '<span class="crumb"><a href="index.html">Prototype 0.2</a>' + icon("chevron-right", "sm") + "<b>" + bar.dataset.title + "</b></span>" +
      '<span class="tools">' +
      '<span class="seg" role="group" aria-label="Colour scheme"><button type="button" data-set="scheme:light">' + icon("sun", "sm") + 'Light</button><button type="button" data-set="scheme:dark">' + icon("moon", "sm") + "Dark</button></span>" +
      '<span class="seg" role="group" aria-label="Width"><button type="button" data-set="view:desktop">' + icon("device-desktop", "sm") + 'Desktop</button><button type="button" data-set="view:phone">' + icon("device-mobile", "sm") + 'Phone</button><button type="button" data-set="view:both">' + icon("layout-columns", "sm") + "Side by side</button></span>" +
      '<span class="seg" role="group" aria-label="Motion"><button type="button" data-set="motion:off">Motion</button><button type="button" data-set="motion:on">Reduced motion</button></span>' +
      '<span class="seg" role="group" aria-label="Notes"><button type="button" data-set="notes:shown">Notes</button><button type="button" data-set="notes:hidden">Hide</button></span>' +
      "</span>";
  };

  // States a page offers ("Read only asked" / "Read and write asked"): `data-show="group:value"`
  // sets `data-group="value"` on the root, which the page's CSS reads.
  const showState = (spec) => {
    const [group, value] = spec.split(":");

    root.dataset[group] = value;
    document.querySelectorAll('[data-show^="' + group + ':"]').forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.show === spec));
    });
  };

  // The operations detail (#128): open adds `.open`; close adds `.closing` (the content fades
  // out), then takes both away once the column has closed.
  const detail = {
    open(ops) {
      ops.classList.remove("closing");
      ops.classList.add("open");
    },
    close(ops) {
      if (!ops.classList.contains("open")) {
        return;
      }

      ops.classList.add("closing");
      window.setTimeout(() => ops.classList.remove("open", "closing"), root.dataset.reducedMotion === "on" ? 0 : 330);
    },
  };

  document.addEventListener("click", (event) => {
    // A click's target is always an element here: the pages hold no bare text outside one.
    const target = event.target;

    if (!target.closest) {
      return;
    }

    const setter = target.closest("[data-set]");

    if (setter) {
      const [key, value] = setter.dataset.set.split(":");
      store.set(key, value);
      apply();

      return;
    }

    const shower = target.closest("[data-show]");

    if (shower) {
      showState(shower.dataset.show);

      return;
    }

    const row = target.closest("[data-op]");

    if (row) {
      const ops = row.closest(".ops");
      ops.querySelectorAll("[data-op]").forEach((other) => other.setAttribute("aria-selected", String(other === row)));
      detail.open(ops);

      return;
    }

    const closer = target.closest("[data-close-detail]");

    if (closer) {
      detail.close(closer.closest(".ops"));

      return;
    }

    const replay = target.closest("[data-replay]");

    if (replay) {
      const spec = replay.dataset.replay;

      if (spec === "detail") {
        document.querySelectorAll(".ops").forEach((ops) => {
          detail.close(ops);
          window.setTimeout(() => detail.open(ops), 700);
        });
      } else {
        setOpen(spec, false);
        window.setTimeout(() => setOpen(spec, true), 600);
      }

      return;
    }

    const opener = target.closest("[data-open-target]");

    if (opener) {
      setOpen(opener.dataset.openTarget, true);

      return;
    }

    const shutter = target.closest("[data-close-target]");

    // #121, after #103: while the form is sent, a press on the backdrop closes nothing.
    if (shutter && !(shutter.hasAttribute("data-unless-sending") && root.dataset.form === "sending")) {
      setOpen(shutter.dataset.closeTarget, false);
    }
  });

  const luminance = (css) => {
    const numbers = (css.match(/-?[\d.]+(e-?\d+)?%?/g) ?? []).map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part)));
    let linear;

    if (css.startsWith("oklch")) {
      const [L, C, h] = numbers;
      const rad = (h * Math.PI) / 180;
      linear = fromOklab(L, C * Math.cos(rad), C * Math.sin(rad));
    } else if (css.startsWith("oklab")) {
      linear = fromOklab(numbers[0], numbers[1], numbers[2]);
    } else if (css.startsWith("color(srgb")) {
      linear = numbers.slice(0, 3).map(toLinear);
    } else if (css.startsWith("rgb")) {
      linear = numbers.slice(0, 3).map((value) => toLinear(value / 255));
    } else {
      return null;
    }

    const [r, g, b] = linear.map((value) => Math.min(1, Math.max(0, value)));

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const measure = () => {
    document.querySelectorAll("[data-contrast]").forEach((out) => {
      const [fgSelector, bgSelector] = out.dataset.contrast.split("|");
      const fg = document.querySelector(fgSelector);
      const bg = document.querySelector(bgSelector);

      if (!fg || !bg) {
        return;
      }

      const a = luminance(getComputedStyle(fg).color);
      const b = luminance(getComputedStyle(bg).backgroundColor);

      if (a === null || b === null) {
        out.textContent = "n/a";

        return;
      }

      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      out.textContent = ratio.toFixed(2) + ":1";
      out.dataset.pass = String(ratio >= 4.5);
    });
  };

  document.querySelectorAll(".bar[data-title]").forEach(toolbar);
  document.querySelectorAll("aside.sidebar[data-current]").forEach(sidebar);
  document.querySelectorAll("nav.tabbar[data-current]").forEach(tabbar);
  document.querySelectorAll(".statusbar").forEach(statusbar);
  document.querySelectorAll("[data-brand]").forEach((element) => {
    element.innerHTML = LOGO;
  });
  document.querySelectorAll("[data-show][data-default]").forEach((button) => showState(button.dataset.show));
  apply();
  window.addEventListener("resize", fit);
  new MutationObserver(() => window.requestAnimationFrame(measure)).observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] });
  window.requestAnimationFrame(measure);
  window.gousset = { detail };
}

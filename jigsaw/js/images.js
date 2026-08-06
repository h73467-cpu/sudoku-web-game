// Small hand-drawn SVG illustration library used as the "picture" for
// 拼圖 (jigsaw). Deliberately simple flat-primitive shapes (rect/circle/
// ellipse/polygon/line, one quadratic path for the cat's mouth) rather than
// anything with fine detail — the whole point is these still read clearly
// after being sliced into up to 25 grid pieces, and elaborate paths would
// just disappear at that granularity. No external image files: this keeps
// the hub fully self-contained (same reasoning as every other game here
// generating its own content rather than depending on an asset).
var JigsawImages = (function () {
  const VIEWBOX = 300;

  const IMAGES = [
    {
      id: "house",
      title: "小屋",
      markup: `
        <rect width="300" height="300" fill="#bfe3f7"/>
        <rect x="0" y="200" width="300" height="100" fill="#8bc34a"/>
        <circle cx="250" cy="60" r="35" fill="#ffd54f"/>
        <rect x="35" y="190" width="14" height="50" fill="#8d6e42"/>
        <circle cx="42" cy="175" r="32" fill="#4caf50"/>
        <circle cx="20" cy="195" r="24" fill="#4caf50"/>
        <circle cx="64" cy="195" r="24" fill="#4caf50"/>
        <polygon points="70,150 220,150 145,70" fill="#c0392b"/>
        <rect x="90" y="150" width="110" height="90" fill="#e8c39e"/>
        <rect x="130" y="190" width="30" height="50" fill="#6d4c31"/>
        <rect x="105" y="165" width="25" height="25" fill="#ffffff" stroke="#6d4c31" stroke-width="3"/>
        <rect x="165" y="165" width="25" height="25" fill="#ffffff" stroke="#6d4c31" stroke-width="3"/>
        <line x1="117" y1="165" x2="117" y2="190" stroke="#6d4c31" stroke-width="2"/>
        <line x1="105" y1="177" x2="130" y2="177" stroke="#6d4c31" stroke-width="2"/>
        <line x1="177" y1="165" x2="177" y2="190" stroke="#6d4c31" stroke-width="2"/>
        <line x1="165" y1="177" x2="190" y2="177" stroke="#6d4c31" stroke-width="2"/>
      `,
    },
    {
      id: "sailboat",
      title: "帆船",
      markup: `
        <rect width="300" height="300" fill="#bfe3f7"/>
        <rect x="0" y="180" width="300" height="120" fill="#4a90d9"/>
        <circle cx="240" cy="60" r="30" fill="#ffd54f"/>
        <ellipse cx="70" cy="70" rx="35" ry="15" fill="#ffffff"/>
        <ellipse cx="100" cy="65" rx="25" ry="12" fill="#ffffff"/>
        <polygon points="110,190 190,190 170,222 130,222" fill="#8d6e42"/>
        <rect x="147" y="108" width="6" height="88" fill="#6d4c31"/>
        <polygon points="153,113 153,185 210,175" fill="#ffffff" stroke="#c9ccd4" stroke-width="2"/>
        <polygon points="153,113 153,135 172,120" fill="#e74c3c"/>
      `,
    },
    {
      id: "sunflower",
      title: "向日葵",
      markup: `
        <rect width="300" height="300" fill="#bfe3f7"/>
        <rect x="0" y="250" width="300" height="50" fill="#8bc34a"/>
        <rect x="142" y="170" width="16" height="90" fill="#4caf50"/>
        <ellipse cx="120" cy="220" rx="28" ry="14" fill="#4caf50" transform="rotate(-20 120 220)"/>
        <ellipse cx="182" cy="235" rx="28" ry="14" fill="#4caf50" transform="rotate(20 182 235)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(0 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(36 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(72 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(108 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(144 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(180 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(216 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(252 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(288 150 150)"/>
        <ellipse cx="225" cy="150" rx="45" ry="20" fill="#ffca28" transform="rotate(324 150 150)"/>
        <circle cx="150" cy="150" r="38" fill="#6d4c31"/>
      `,
    },
    {
      id: "cat",
      title: "貓咪",
      markup: `
        <rect width="300" height="300" fill="#fde8d8"/>
        <polygon points="90,90 130,150 60,150" fill="#f0a868"/>
        <polygon points="210,90 240,150 170,150" fill="#f0a868"/>
        <polygon points="98,105 122,140 85,140" fill="#f7c9a3"/>
        <polygon points="202,105 215,140 178,140" fill="#f7c9a3"/>
        <circle cx="150" cy="180" r="90" fill="#f0a868"/>
        <line x1="60" y1="185" x2="112" y2="190" stroke="#6d4c31" stroke-width="2"/>
        <line x1="60" y1="205" x2="112" y2="205" stroke="#6d4c31" stroke-width="2"/>
        <line x1="240" y1="185" x2="188" y2="190" stroke="#6d4c31" stroke-width="2"/>
        <line x1="240" y1="205" x2="188" y2="205" stroke="#6d4c31" stroke-width="2"/>
        <circle cx="115" cy="170" r="14" fill="#2b2b2b"/>
        <circle cx="185" cy="170" r="14" fill="#2b2b2b"/>
        <circle cx="119" cy="165" r="4" fill="#ffffff"/>
        <circle cx="189" cy="165" r="4" fill="#ffffff"/>
        <polygon points="142,195 158,195 150,208" fill="#e8849a"/>
        <line x1="150" y1="208" x2="150" y2="216" stroke="#6d4c31" stroke-width="3"/>
        <path d="M150 216 Q136 228 122 218" stroke="#6d4c31" stroke-width="3" fill="none"/>
        <path d="M150 216 Q164 228 178 218" stroke="#6d4c31" stroke-width="3" fill="none"/>
      `,
    },
    {
      id: "rainbow",
      title: "彩虹",
      markup: `
        <rect width="300" height="300" fill="#bfe3f7"/>
        <circle cx="40" cy="240" r="22" fill="#ffffff"/>
        <circle cx="62" cy="230" r="26" fill="#ffffff"/>
        <circle cx="85" cy="242" r="20" fill="#ffffff"/>
        <circle cx="230" cy="255" r="20" fill="#ffffff"/>
        <circle cx="252" cy="245" r="25" fill="#ffffff"/>
        <circle cx="272" cy="257" r="18" fill="#ffffff"/>
        <circle cx="150" cy="300" r="150" fill="#e74c3c"/>
        <circle cx="150" cy="300" r="130" fill="#f39c12"/>
        <circle cx="150" cy="300" r="110" fill="#f1c40f"/>
        <circle cx="150" cy="300" r="90" fill="#2ecc71"/>
        <circle cx="150" cy="300" r="70" fill="#3498db"/>
        <circle cx="150" cy="300" r="50" fill="#9b59b6"/>
        <circle cx="150" cy="300" r="30" fill="#bfe3f7"/>
      `,
    },
    {
      id: "butterfly",
      title: "蝴蝶",
      markup: `
        <rect width="300" height="300" fill="#eafaf1"/>
        <ellipse cx="105" cy="120" rx="55" ry="45" fill="#5dade2" transform="rotate(-15 105 120)"/>
        <ellipse cx="195" cy="120" rx="55" ry="45" fill="#5dade2" transform="rotate(15 195 120)"/>
        <ellipse cx="115" cy="195" rx="42" ry="34" fill="#f5b7b1" transform="rotate(-10 115 195)"/>
        <ellipse cx="185" cy="195" rx="42" ry="34" fill="#f5b7b1" transform="rotate(10 185 195)"/>
        <circle cx="95" cy="110" r="10" fill="#2e86c1"/>
        <circle cx="205" cy="110" r="10" fill="#2e86c1"/>
        <circle cx="110" cy="190" r="8" fill="#e6798a"/>
        <circle cx="190" cy="190" r="8" fill="#e6798a"/>
        <ellipse cx="150" cy="155" rx="10" ry="60" fill="#4a3b32"/>
        <line x1="145" y1="100" x2="130" y2="70" stroke="#4a3b32" stroke-width="3"/>
        <line x1="155" y1="100" x2="170" y2="70" stroke="#4a3b32" stroke-width="3"/>
        <circle cx="130" cy="70" r="4" fill="#4a3b32"/>
        <circle cx="170" cy="70" r="4" fill="#4a3b32"/>
      `,
    },
  ];

  function fullSvgMarkup(image) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">` +
      image.markup +
      `</svg>`
    );
  }

  function dataUri(image) {
    return "data:image/svg+xml;utf8," + encodeURIComponent(fullSvgMarkup(image));
  }

  function byId(id) {
    return IMAGES.find((img) => img.id === id) || IMAGES[0];
  }

  function randomImage() {
    return IMAGES[Math.floor(Math.random() * IMAGES.length)];
  }

  return {
    IMAGES,
    byId,
    randomImage,
    dataUri,
  };
})();

if (typeof window !== "undefined") {
  window.JigsawImages = JigsawImages;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = JigsawImages;
}

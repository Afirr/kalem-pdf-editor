// Font kaydı: önizleme (CSS) ve dışa aktarma (TTF gömme) aynı listeden beslenir.
// Tüm dosyalar Türkçe karakter destekli; normal + kalın ağırlıklar ayrı TTF'ler.
export const FONTS = {
  arial: {
    label: 'Arial',
    css: 'Arial, Helvetica, sans-serif',
    file: '/fonts/Arial.ttf',
    boldFile: '/fonts/Arial-Bold.ttf',
  },
  montserrat: {
    label: 'Montserrat',
    css: "'Montserrat', sans-serif",
    file: '/fonts/Montserrat.ttf',
    boldFile: '/fonts/Montserrat-Bold.ttf',
  },
  opensans: {
    label: 'Open Sans',
    css: "'Open Sans', sans-serif",
    file: '/fonts/OpenSans.ttf',
    boldFile: '/fonts/OpenSans-Bold.ttf',
  },
  times: {
    label: 'Times',
    css: "'Times New Roman', Times, serif",
    file: '/fonts/Times.ttf',
    boldFile: '/fonts/Times-Bold.ttf',
  },
  playfair: {
    label: 'Playfair Display',
    css: "'Playfair Display', Georgia, serif",
    file: '/fonts/Playfair.ttf',
    boldFile: '/fonts/Playfair-Bold.ttf',
  },
  cousine: {
    label: 'Courier (Cousine)',
    css: "'Cousine', 'Courier New', monospace",
    file: '/fonts/Cousine.ttf',
    boldFile: '/fonts/Cousine-Bold.ttf',
  },
  script: {
    label: 'El yazısı',
    css: "'Dancing Script', cursive",
    file: '/fonts/DancingScript.ttf',
    boldFile: '/fonts/DancingScript-Bold.ttf',
  },
};

// PDF'in içindeki GERÇEK font adından (ör. "ABCDEF+Montserrat-SemiBold")
// listedeki en yakın aileyi seçer — "font tanıma"nın özü bu eşleme.
// Sıra önemli: özgül aile adları önce, genel serif/sans sınıflaması en sonda.
export function detectFontKey(rawName, genericFamily) {
  const n = (rawName || '').replace(/^[A-Z]{6}\+/, '').toLowerCase();
  if (/montserrat|futura|gotham|proxima|poppins|raleway|nunito|century ?gothic|avant/.test(n)) return 'montserrat';
  if (/open ?sans|noto ?sans|segoe|lato|source ?sans|pt ?sans|tahoma|verdana|calibri/.test(n)) return 'opensans';
  if (/playfair|didot|bodoni|garamond|baskerv|cormorant|caslon/.test(n)) return 'playfair';
  if (/courier|cousine|consol|menlo|monaco|roboto ?mono|source ?code|[-_ ]mono/.test(n)) return 'cousine';
  if (/dancing|script|pacifico|brush|handwr|caveat|satisfy|lobster|signature|sacramento|allura|great ?vibes/.test(n)) return 'script';
  if (/times|tinos|georgia|merriweather|pt ?serif|book ?antiqua|palatino|cambria|charter|liberation ?serif/.test(n)) return 'times';
  if (/arial|helvetica|arimo|liberation ?sans|roboto|inter|dejavu ?sans/.test(n)) return 'arial';
  if (n && /serif/.test(n) && !/sans/.test(n)) return 'times';
  const fam = (genericFamily || '').toLowerCase();
  return /serif/.test(fam) && !/sans/.test(fam) ? 'times' : 'arial';
}

// Ham PDF font adını kullanıcıya gösterilebilir hâle getirir
// (alt küme öneki "ABCDEF+" atılır); yoksa boş döner.
export function prettyFontName(rawName) {
  return (rawName || '').replace(/^[A-Z]{6}\+/, '');
}

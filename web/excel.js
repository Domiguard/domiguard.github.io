/* Domiguard: genera un archivo de Excel (.xlsx) en el navegador, sin librerías.
   Un .xlsx es un ZIP con hojas en XML: aquí se arma con los archivos mínimos que Excel, Numbers y
   Google Sheets abren sin avisos. Encabezado en negritas (azul marino), primera fila fija y filtros. */
(function () {
  "use strict";
  var NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* texto seguro para XML: se escapan los símbolos y se quitan caracteres de control que Excel rechaza */
  function x(v) {
    return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function columna(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  /* las celdas de texto van como texto en línea: nunca se interpretan como fórmulas */
  function celda(v, ref, estilo) {
    var s = estilo ? ' s="' + estilo + '"' : "";
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"' + s + "><v>" + v + "</v></c>";
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + x(v) + "</t></is></c>";
  }
  function hoja(encabezados, filas, anchos) {
    var ultima = columna(encabezados.length - 1) + (filas.length + 1);
    var cols = encabezados.map(function (_, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (anchos[i] || 14) + '" customWidth="1"/>'; }).join("");
    var datos = [encabezados].concat(filas).map(function (f, r) {
      return '<row r="' + (r + 1) + '">' + f.map(function (v, c) { return celda(v, columna(c) + (r + 1), r ? 0 : 1); }).join("") + "</row>";
    }).join("");
    return CAB + "<worksheet " + NS + ">" +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      "<cols>" + cols + "</cols><sheetData>" + datos + "</sheetData>" +
      '<autoFilter ref="A1:' + ultima + '"/></worksheet>';
  }
  function partes(nombreHoja, encabezados, filas, anchos) {
    var ultima = "$" + columna(encabezados.length - 1) + "$" + (filas.length + 1);
    return [
      ["[Content_Types].xml", CAB + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ["_rels/.rels", CAB + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", CAB + "<workbook " + NS + '><sheets><sheet name="' + x(nombreHoja) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + x(nombreHoja) + "'!$A$1:" + ultima + "</definedName></definedNames></workbook>"],
      ["xl/_rels/workbook.xml.rels", CAB + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml", CAB + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ["xl/worksheets/sheet1.xml", hoja(encabezados, filas, anchos)]
    ];
  }

  /* ---------- ZIP sin compresión (método "stored") ---------- */
  var TABLA = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(archivos) {
    var enc = new TextEncoder(), d = new Date();
    var hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var trozos = [], central = [], desplaz = 0;
    function cab(tam) { var b = new Uint8Array(tam); return { b: b, v: new DataView(b.buffer) }; }
    archivos.forEach(function (a) {
      var nombre = enc.encode(a[0]), datos = enc.encode(a[1]), crc = crc32(datos);
      var l = cab(30); l.v.setUint32(0, 0x04034b50, true); l.v.setUint16(4, 20, true); l.v.setUint16(10, hora, true); l.v.setUint16(12, fecha, true);
      l.v.setUint32(14, crc, true); l.v.setUint32(18, datos.length, true); l.v.setUint32(22, datos.length, true); l.v.setUint16(26, nombre.length, true);
      var c = cab(46); c.v.setUint32(0, 0x02014b50, true); c.v.setUint16(4, 20, true); c.v.setUint16(6, 20, true); c.v.setUint16(12, hora, true); c.v.setUint16(14, fecha, true);
      c.v.setUint32(16, crc, true); c.v.setUint32(20, datos.length, true); c.v.setUint32(24, datos.length, true); c.v.setUint16(28, nombre.length, true); c.v.setUint32(42, desplaz, true);
      trozos.push(l.b, nombre, datos); central.push(c.b, nombre);
      desplaz += 30 + nombre.length + datos.length;
    });
    var tamCentral = central.reduce(function (s, b) { return s + b.length; }, 0);
    var fin = cab(22); fin.v.setUint32(0, 0x06054b50, true); fin.v.setUint16(8, archivos.length, true); fin.v.setUint16(10, archivos.length, true);
    fin.v.setUint32(12, tamCentral, true); fin.v.setUint32(16, desplaz, true);
    return new Blob(trozos.concat(central, [fin.b]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function crear(nombreHoja, encabezados, filas, anchos) { return zip(partes(nombreHoja.slice(0, 31), encabezados, filas, anchos || [])); }
  function descargar(archivo, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = archivo; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  window.DomiguardExcel = { crear: crear, descargar: descargar };
})();

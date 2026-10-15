"""Small, dependency-free XLSX export for the application's flat tables.

Text is explicitly stored as inline strings, including values beginning with '='.
This writer intentionally supports only the two layouts used by this application.
"""
from datetime import date
from io import BytesIO
import math
import re
import unicodedata
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZipFile, ZIP_DEFLATED

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def column(index):
    result = ''
    while index:
        index, digit = divmod(index - 1, 26)
        result = chr(65 + digit) + result
    return result


def width(text):
    return sum(2 if unicodedata.east_asian_width(c) in ('W', 'F') else 1 for c in str(text))


def safe_filename(value):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', value).strip('. ')[:160] or '歌单'


STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="{NS}">
 <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
 <fonts count="3">
  <font><sz val="11"/><color rgb="FF23302A"/><name val="Arial"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
  <font><b/><sz val="16"/><color rgb="FF23302A"/><name val="Arial"/></font>
 </fonts>
 <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF294B3C"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF0F5F1"/><bgColor indexed="64"/></patternFill></fill>
 </fills>
 <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="8">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''


def cell(ref, value, style=0):
    if isinstance(value, date):
        serial = (value - date(1899, 12, 30)).days
        return f'<c r="{ref}" s="{5 if style == 3 else 4}"><v>{serial}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def worksheet(title, subtitle, headers, rows, widths, filterable=True):
    end = column(len(headers))
    subtitle_height = max(24, math.ceil(width(subtitle) / (sum(widths) - 2)) * 16 + 8)
    view = '<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>' if filterable else ''
    xml = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{NS}">',
           '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
           f'<dimension ref="A1:{end}{max(5 + len(rows), 5)}"/>',
           f'<sheetViews><sheetView showGridLines="0" workbookViewId="0">{view}</sheetView></sheetViews>',
           '<sheetFormatPr defaultRowHeight="24"/><cols>']
    for i, size in enumerate(widths, 1):
        xml.append(f'<col min="{i}" max="{i}" width="{size}" customWidth="1"/>')
    xml += ['</cols><sheetData>', f'<row r="2" ht="28" customHeight="1">{cell("A2", title, 2)}</row>',
            f'<row r="3" ht="{subtitle_height}" customHeight="1">{cell("A3", subtitle)}</row>',
            '<row r="5" ht="28" customHeight="1">' + ''.join(cell(f'{column(i)}5', v, 1) for i, v in enumerate(headers, 1)) + '</row>']
    for n, row in enumerate(rows, 6):
        lines = max([1] + [sum(max(1, math.ceil(width(part) / max(1, size - 2))) for part in str(v).split('\n')) for v, size in zip(row, widths)])
        height = min(409, max(27, lines * 16 + 8))
        xml.append(f'<row r="{n}" ht="{height}" customHeight="1">' + ''.join(cell(f'{column(i)}{n}', v, (7 if n % 2 == 0 else 6) if i == 1 and headers[0] == '序号' else (3 if n % 2 == 0 else 0)) for i, v in enumerate(row, 1)) + '</row>')
    xml.append('</sheetData>')
    if filterable and rows:
        xml.append(f'<autoFilter ref="A5:{end}{5 + len(rows)}"/>')
    xml.append(f'<mergeCells count="2"><mergeCell ref="A2:{end}2"/><mergeCell ref="A3:{end}3"/></mergeCells>')
    xml += ['<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>',
            '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>', '</worksheet>']
    return ''.join(xml)


def workbook(sheets):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1)) + '</Types>')
        archive.writestr('_rels/.rels', f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{NS}" xmlns:r="{REL}"><sheets>' + ''.join(f'<sheet name={quoteattr(s[0])} sheetId="{i}" r:id="rId{i}"/>' for i, s in enumerate(sheets, 1)) + '</sheets><definedNames>' + ''.join(f'<definedName name="_xlnm.Print_Titles" localSheetId="{i}">\'{escape(s[0])}\'!$5:$5</definedName>' for i, s in enumerate(sheets)) + '</definedNames></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{REL}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1)) + f'<Relationship Id="styles" Type="{REL}/styles" Target="styles.xml"/></Relationships>')
        archive.writestr('xl/styles.xml', STYLES)
        for i, (_, layout) in enumerate(sheets, 1):
            archive.writestr(f'xl/worksheets/sheet{i}.xml', worksheet(**layout))
    return output.getvalue()


def export_songs(songs, scope='全部曲目'):
    rows = [[s['name'], s['version'], '、'.join(s['languages']), s['status']] for s in songs]
    return workbook([('曲库', dict(title='乐队曲库', subtitle=f'{scope} · 共 {len(rows)} 首 · 导出日期 {date.today().isoformat()}',
                                 headers=['曲目名称', '版本', '语言', '状态'], rows=rows, widths=[38, 32, 26, 14]))])


def export_performance(event):
    archived = event['status'] == '已完成'
    info = [[label, value] for label, value in [('演出日期', date.fromisoformat(event['date'])), ('演出名字', event['name']),
            ('主办方', event['organizer']), ('地点', event['venue']), ('语言', '、'.join(event['languages'])), ('状态', event['status'])]]
    headers = ['序号', '曲目名称', '版本', '语言', '本场备注'] + ([] if archived else ['曲目状态'])
    rows = [[i, item['song']['name'], item['song']['version'], '、'.join(item['song']['languages']), item['note']]
            + ([] if archived else [item['current_status']]) for i, item in enumerate(event['items'], 1)]
    return workbook([
        ('演出信息', dict(title='演出信息', subtitle='实际演出记录' if archived else '演出安排', headers=['项目', '内容'], rows=info, widths=[22, 80], filterable=False)),
        ('演出歌单', dict(title='实际演出歌单' if archived else '演出歌单', subtitle=f'{event["date"]} · {event["name"]}', headers=headers,
                       rows=rows, widths=[9, 32, 26, 22, 48] + ([] if archived else [14])))])

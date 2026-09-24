# Excel uploads with multiple tabs

Upload one `.xlsx` workbook through **Library → Upload files**, or attach it to a private case. You do not need to split its tabs into separate files. The original file remains downloadable.

Every worksheet is inspected. After processing, review the per-tab row counts and warnings, then use **Worksheet** to filter extracted evidence by tab. Empty tabs are reported in the extraction notes and have no searchable passages. Hidden tabs are included and clearly flagged; review their contents before publishing shared knowledge.

Review and publish the workbook once to make its extracted content available to future answers. Use **Check knowledge** with a distinctive value from each tab to verify retrieval. Citations retain the worksheet name and original row number, and extracted text includes cell addresses. Rows with clear `SPN` and `FMI` headers also support fault-code queries such as `1208:3`.

Textual rows near the top are treated as header hints, with their original row number included. Irregular layouts, multiple independent tables, and merged headings should be checked against the original; the extractor does not claim to understand every spreadsheet layout. Merged values appear at their anchor cell. Blank cells and empty rows are skipped without renumbering the source rows.

Formula cells use the result last saved by Excel. The app does not recalculate formulas or refresh external links. Recalculate and save in Excel before uploading. Missing saved results and formulas are marked in the extracted text. Dates use ISO notation; numeric formatting is retained as a note where it affects interpretation, rather than pretending to reproduce Excel's visual formatting. Charts and embedded images remain in the original but are not interpreted as knowledge.

Limits per workbook: 20 MB uploaded, 100 worksheets, 100,000 populated cells, one million extracted characters, 64 MB expanded archive data, and 10,000 archive entries. If a limit is exceeded, the source fails with an explanation; a truncated workbook is not published. Password-encrypted workbooks, `.xls`, and `.xlsm` are not supported. Save an unencrypted `.xlsx` copy when needed.

The stored workbook supplies retrieved evidence to the configured AI; uploading does not retrain its model weights. Retrieval is designed for relevant rows and passages, not exhaustive workbook calculations or guaranteed joins across all tabs.

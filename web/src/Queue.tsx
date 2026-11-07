import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { get, onServerChange, type DisputeRow } from "./api";
import { gridTheme } from "./grid";
import { REASON_LABEL, STATUS_WORD, day, daysLeft, money } from "./words";

export function Queue() {
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  useEffect(() => {
    const load = () => get<DisputeRow[]>("/api/disputes").then(setRows).catch(() => setRows([]));
    load();
    return onServerChange((m) => { if (m.what === "disputes" || m.what === "dispute" || m.what === "docs") load(); });
  }, []);

  const cols = useMemo<ColDef<DisputeRow>[]>(() => [
    { headerName: "Deadline", colId: "due", width: 150, sort: "asc",
      valueGetter: (p) => daysLeft(p.data?.due) ?? 9999,
      cellRenderer: (p: { data: DisputeRow }) => {
        const d = daysLeft(p.data.due);
        if (d === null) return <span className="muted">No deadline</span>;
        return <span style={{ fontWeight: 600, color: d <= 3 ? "var(--conflict)" : undefined }}>{d < 0 ? "Passed" : `${d} day${d === 1 ? "" : "s"} left`}</span>;
      } },
    { headerName: "Reason", flex: 1.4, minWidth: 220, valueGetter: (p) => REASON_LABEL[p.data!.reason] ?? p.data!.reason },
    { headerName: "Amount", width: 130, type: "rightAligned", valueGetter: (p) => Number(p.data!.amount), valueFormatter: (p) => money(p.data?.amount, p.data?.currency) },
    { headerName: "Buyer", flex: 1, minWidth: 150, field: "buyer" },
    { headerName: "Status", flex: 1, minWidth: 190, valueGetter: (p) => STATUS_WORD[p.data!.status] ?? p.data!.status },
    { headerName: "Documents", width: 120, field: "docs", type: "rightAligned" },
    { headerName: "Opened", width: 130, valueGetter: (p) => p.data!.created, valueFormatter: (p) => day(p.value) },
    { headerName: "Dispute", width: 190, field: "id", cellClass: "mono" },
  ], []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Disputes</h1>
          <p className="lede">Each dispute PayPal has opened on your payments, soonest deadline first. Open one to see what PayPal needs from you and what your documents already prove.</p>
        </div>
      </div>
      {rows && rows.length === 0 ? (
        <div className="panel empty-state">
          <h2>No disputes yet</h2>
          <p>When a buyer opens a dispute, PayPal tells ClaimPack and it appears here. You can also pull them in now with <b>Sync with PayPal</b>.</p>
        </div>
      ) : (
        <div className="grid-wrap">
          <AgGridReact<DisputeRow> theme={gridTheme()} rowData={rows ?? undefined} columnDefs={cols} loading={!rows}
            onRowClicked={(e) => { if (e.data) location.hash = `#/disputes/${encodeURIComponent(e.data.id)}`; }}
            rowStyle={{ cursor: "pointer" }} getRowId={(p) => p.data.id} />
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { loadFulfillmentState, recordFulfillmentExport, saveFulfillmentControl } from "@/lib/client/fulfillment-client";
import type { FulfillmentControl, FulfillmentExportHistory } from "@/lib/domain/fulfillment";
import PrinterFulfillment from "./PrinterFulfillment";
import {
  controlledFulfillmentRows,
  downloadFulfillmentProductionList,
  downloadPrinterDesignWorkbook,
  printerAddressRows,
  printerDesignGroups,
  type EnvelopeBatch,
  type FulfillmentData,
  type PrinterDesignGroup,
} from "./fulfillment-selectors";

export interface PrinterFulfillmentContainerProps {
  data: FulfillmentData;
  onDownloadSubscriberSchedule: () => void;
  onOpenEnvelopeBatch: (batch: EnvelopeBatch) => void;
}

export default function PrinterFulfillmentContainer({ data, onDownloadSubscriberSchedule, onOpenEnvelopeBatch }: PrinterFulfillmentContainerProps) {
  const [controls, setControls] = useState<Record<string, FulfillmentControl>>({});
  const [history, setHistory] = useState<FulfillmentExportHistory[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!data.batchDate) return;
    setLoading(true);
    try {
      const loaded = await loadFulfillmentState(data.batchDate);
      setControls(loaded.controls);
      setHistory(loaded.history);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load fulfillment controls."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!data.batchDate) return;
    let cancelled = false;
    void loadFulfillmentState(data.batchDate)
      .then((loaded) => {
        if (cancelled) return;
        setControls(loaded.controls);
        setHistory(loaded.history);
        setMessage("");
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load fulfillment controls.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [data.batchDate]);

  const rows = useMemo(() => controlledFulfillmentRows(data, controls), [data, controls]);

  async function updateControl(row: (typeof rows)[number], next: FulfillmentControl) {
    const key = `${row.mailing.mailingId}::${row.mailing.sourceRow}`;
    setControls((current) => ({ ...current, [key]: next }));
    try { await saveFulfillmentControl(row.mailing.mailingId, row.mailing.sourceRow, next); setMessage("Saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save fulfillment control."); await refresh(); }
  }

  async function exportGroup(group: PrinterDesignGroup, batchName: string) {
    const previous = history.filter((item) => item.designGroup === group.designGroup && item.exportKind === group.exportKind);
    if (previous.length && !window.confirm(`${group.designGroup} was already exported ${previous.length} time${previous.length === 1 ? "" : "s"}. Re-export it?`)) return;
    const snapshot = group.rows.map((row, index) => ({ mailingId: row.mailing.mailingId, sourceRow: row.mailing.sourceRow, page: index + 1, ...printerAddressRows({ ...group, rows: [row] })[0] }));
    try {
      await recordFulfillmentExport({ batchDate: group.batchDate, batchName, exportKind: group.exportKind, designGroup: group.designGroup, snapshot });
      await downloadPrinterDesignWorkbook(group, batchName);
      setMessage(`${group.designGroup} archived and downloaded.`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not export this design batch."); }
  }

  async function exportProductionList(batchName: string) {
    const snapshot = rows.map((row) => ({ mailingId: row.mailing.mailingId, sourceRow: row.mailing.sourceRow, orderId: row.orderNumber, recipient: row.mailing.recipientName, status: row.control.fulfillmentStatus }));
    try {
      await recordFulfillmentExport({ batchDate: data.batchDate, batchName, exportKind: "Main", designGroup: "COMBINED_PRODUCTION_LIST", snapshot });
      await downloadFulfillmentProductionList(data, controls, batchName);
      setMessage("Production list archived and downloaded.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not export the production list."); }
  }

  return <PrinterFulfillment
    key={data.batchDate}
    data={data}
    controls={controls}
    history={history}
    loading={loading}
    message={message}
    mainGroups={printerDesignGroups(data, controls, "Main")}
    lateGroups={printerDesignGroups(data, controls, "Late addendum")}
    onControlChange={updateControl}
    onExportGroup={exportGroup}
    onDownloadProductionList={exportProductionList}
    onDownloadSubscriberSchedule={onDownloadSubscriberSchedule}
    onOpenEnvelopeBatch={onOpenEnvelopeBatch}
  />;
}

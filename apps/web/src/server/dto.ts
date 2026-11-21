import {
  explorerAddressUrl,
  explorerTxUrl,
  formatEth,
  formatTokenAmount,
  type ContactProposal,
  type LedgerEntry,
  type Recap,
  type TransferDraft,
  type TransferResult,
} from "@gta/core";
import type { DraftDto, EntryDto, ProposalDto, RecapDto, ResultDto } from "../shared/types";

export function draftDto(d: TransferDraft): DraftDto {
  return {
    id: d.id,
    from: d.from,
    to: d.to,
    contactName: d.contactName ?? null,
    amountEth: formatEth(d.amountWei),
    estimatedFeeEth: formatEth(d.estimatedFeeWei),
    totalEth: formatEth(d.totalWei),
    wantedLevel: d.wantedLevel,
    isNewRecipient: d.isNewRecipient,
    dailySentEth: formatEth(d.dailySentWei),
    expiresAt: d.expiresAt,
    explorerAddressUrl: explorerAddressUrl(d.to),
    token: d.token
      ? {
          symbol: d.token.symbol,
          address: d.token.address,
          amount: formatTokenAmount(d.token.amountUnits, d.token.decimals),
        }
      : null,
  };
}

export function resultDto(r: TransferResult): ResultDto {
  return {
    hash: r.hash,
    status: r.status,
    explorerUrl: r.explorerUrl,
    feeEth: r.feeWei === undefined ? null : formatEth(r.feeWei),
  };
}

export function proposalDto(p: ContactProposal): ProposalDto {
  return { id: p.id, name: p.name, address: p.address };
}

export function entryDto(e: LedgerEntry): EntryDto {
  const internal = e.hash.startsWith("internal:");
  return {
    hash: e.hash,
    direction: e.direction,
    counterparty: e.counterparty,
    contactName: e.contactName ?? null,
    amountEth: formatEth(e.amountWei),
    amountWei: e.amountWei.toString(),
    feeEth: e.feeWei === undefined ? null : formatEth(e.feeWei),
    status: e.status,
    timestamp: e.timestamp,
    category: e.category ?? null,
    note: e.note ?? null,
    source: e.source,
    explorerUrl: internal ? explorerAddressUrl(e.counterparty) : explorerTxUrl(e.hash),
    token: e.token
      ? { symbol: e.token.symbol, amount: formatTokenAmount(e.token.amountUnits, e.token.decimals) }
      : null,
  };
}

export function recapDto(r: Recap, entries: LedgerEntry[]): RecapDto {
  return {
    period: r.period,
    totals: {
      inEth: formatEth(r.totals.inWei),
      outEth: formatEth(r.totals.outWei),
      feeEth: formatEth(r.totals.feeWei),
      netEth: formatEth(r.totals.netWei),
      netNegative: r.totals.netWei < 0n,
      count: r.totals.count,
      pending: r.totals.pending,
    },
    byCategory: r.byCategory.map((c) => ({
      category: c.category,
      inEth: formatEth(c.inWei),
      outEth: formatEth(c.outWei),
      inWei: c.inWei.toString(),
      outWei: c.outWei.toString(),
      count: c.count,
    })),
    byCounterparty: r.byCounterparty.slice(0, 8).map((c) => ({
      label: c.label,
      address: c.address ?? null,
      inEth: formatEth(c.inWei),
      outEth: formatEth(c.outWei),
      count: c.count,
    })),
    series: r.series.map((s) => ({
      key: s.key,
      start: s.start,
      inWei: s.inWei.toString(),
      outWei: s.outWei.toString(),
      inEth: formatEth(s.inWei),
      outEth: formatEth(s.outWei),
    })),
    entries: entries.map(entryDto),
  };
}

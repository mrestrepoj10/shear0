/**
 * The shear0 report catalog — the json-render vocabulary a calc sheet is written
 * in.
 *
 * A report is *data* before it is markup: the engine already produces a traced
 * DAG (symbol, value, unit, LaTeX, ACI reference), so the shareable calc sheet
 * is a JSON spec built from that DAG against this catalog, and each output
 * medium gets its own registry. The on-screen report view maps these components
 * onto the existing UI pieces (KaTeX, status badges, utilization bars); the PDF
 * export walks the same wall through `pdf-spec.ts` against the react-pdf
 * standard components. What a report *says* is decided exactly once, here.
 *
 * Plain module, no `"use client"`: the spec is built on the server so a shared
 * report link renders in the first HTML, same as `/design` itself.
 */

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const STATUS = z.enum(["ok", "ng", "warning", "na"]);

export const reportCatalog = defineCatalog(schema, {
  components: {
    Report: {
      props: z.object({}),
      description: "Root container for a calc sheet",
    },
    ReportHeader: {
      props: z.object({
        title: z.string(),
        subtitle: z.string(),
        status: STATUS,
        generatedAt: z.string(),
        /** canonical share link for the wall this report was built from */
        link: z.string(),
      }),
      description: "Report title block with the overall verdict",
    },
    Section: {
      props: z.object({ title: z.string() }),
      description: "Titled report section",
    },
    KeyValueGrid: {
      props: z.object({
        rows: z.array(z.tuple([z.string(), z.string()])),
      }),
      description: "Two-column label/value listing (inputs, materials)",
    },
    CheckBlock: {
      props: z.object({
        title: z.string(),
        section: z.string(),
        eq: z.string().nullable(),
        status: STATUS,
      }),
      description: "One code check: title, ACI reference, status, and its trace",
    },
    Quantity: {
      props: z.object({
        symbol: z.string(),
        label: z.string(),
        value: z.string(),
        note: z.string().nullable(),
        status: STATUS.nullable(),
        /** visual nesting depth in the trace, 0 = check summary row */
        depth: z.number(),
      }),
      description: "A traced quantity: symbol, value with unit, label",
    },
    Formula: {
      props: z.object({
        formula: z.string(),
        substitution: z.string(),
        depth: z.number(),
      }),
      description: "LaTeX formula with its numeric substitution",
    },
    Utilization: {
      props: z.object({ value: z.number(), status: STATUS }),
      description: "Demand/capacity ratio bar",
    },
  },
  actions: {},
});

export type ReportCatalog = typeof reportCatalog;

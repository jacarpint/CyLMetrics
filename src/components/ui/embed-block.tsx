'use client';

import { Copy } from "lucide-react";

export default function EmbedBlock({ url, label }: { url: string; label: string }) {
  const embedCode = `<img src="${url}" alt="${label}" />`;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-faint">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-fill border border-border rounded px-2 py-1.5 font-mono truncate">{embedCode}</code>
        <button
          onClick={() => navigator.clipboard.writeText(embedCode)}
          className="text-faint hover:text-primary shrink-0"
          title="Copiar"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

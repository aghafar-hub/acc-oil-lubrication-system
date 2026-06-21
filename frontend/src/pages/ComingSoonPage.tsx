import { useTranslation } from "react-i18next";

export function ComingSoonPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-display)" }}>{t(titleKey)}</h1>
      <div className="bg-white rounded-md border border-[var(--color-line)] p-8 text-center">
        <p className="text-sm text-[var(--color-ink-muted)]">
          This screen's API is complete and live — the interface for it is still being built.
        </p>
      </div>
    </div>
  );
}

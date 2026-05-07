"use client";

interface Props {
  currentUrl: string | null;
}

export function AvatarUploader({ currentUrl: _currentUrl }: Props) {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      Avatar — TODO Task 12
    </div>
  );
}

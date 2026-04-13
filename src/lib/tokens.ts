export function generateId(): string {
  return crypto.randomUUID();
}

export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30)
    .replace(/^-|-$/g, '');

  const suffix = crypto.randomUUID().slice(0, 6);
  return `${base}-${suffix}`;
}

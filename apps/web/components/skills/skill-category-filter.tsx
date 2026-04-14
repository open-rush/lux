'use client';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'ui-components', label: 'UI' },
  { id: 'documentation', label: 'Docs' },
  { id: 'code-quality', label: 'Code Quality' },
  { id: 'database', label: 'Database' },
  { id: 'security', label: 'Security' },
  { id: 'testing', label: 'Testing' },
  { id: 'ai-sdk', label: 'AI & SDK' },
] as const;

interface SkillCategoryFilterProps {
  value: string;
  onChange: (category: string) => void;
}

export function SkillCategoryFilter({ value, onChange }: SkillCategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onChange(cat.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === cat.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}

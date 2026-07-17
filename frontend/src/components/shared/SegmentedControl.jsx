import clsx from 'clsx'

export default function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented-control">
      {options.map(opt => (
        <button
          key={opt.value || opt}
          className={clsx('seg-option', (value === (opt.value || opt)) && 'active')}
          onClick={() => onChange(opt.value || opt)}
        >
          {opt.label || opt}
        </button>
      ))}
    </div>
  )
}

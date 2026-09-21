import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface SessionOption {
  id: string
  label: string
}

interface ComboboxProps {
  options: SessionOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function RecentSessionsCombobox({ options, value, onChange, placeholder = "Select a session..." }: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal text-left h-auto py-2"
        >
          <span className="truncate">
          {value
            ? options.find((option) => option.id === value)?.label ?? value
            : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search sessions..." />
          <CommandList>
            <CommandEmpty>No session found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.label}
                  onSelect={(currentValue) => {
                    const selected = options.find((o) => o.label.toLowerCase() === currentValue.toLowerCase());
                    if (selected) {
                      onChange(selected.id === value ? "" : selected.id)
                    } else {
                      // fallback if strict matching fails
                      onChange(option.id === value ? "" : option.id)
                    }
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 flex-shrink-0",
                      value === option.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

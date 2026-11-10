"use client"

import { useEffect, useState } from "react"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAgentActions } from "@/components/agent/agent-actions"
import { TOUR_STEPS, hasSeenWelcome, markWelcomeSeen } from "@/lib/onboarding"

/** Starts the built-in guided tour (header button, Commands menu, welcome dialog). The agent starts it through the start_tour action. */
export function useStartTour() {
  const { setSpotlight } = useAgentActions()
  return () => setSpotlight({ kind: "tour", steps: TOUR_STEPS, index: 0 })
}

export function TakeTourButton() {
  const start = useStartTour()
  return (
    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={start} data-testid="take-tour" aria-label="Take the tour">
      <Compass className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Take the tour</span>
    </Button>
  )
}

/** Shown once per browser on the first visit; "Skip" or "Take the tour" both count as seen. Re-open it with Take the tour. */
export function WelcomeDialog() {
  const [open, setOpen] = useState(false)
  const start = useStartTour()
  useEffect(() => {
    if (!hasSeenWelcome(localStorage)) setOpen(true)
  }, [])
  const close = () => {
    markWelcomeSeen(localStorage)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent data-testid="welcome">
        <DialogHeader>
          <DialogTitle>Welcome</DialogTitle>
          <DialogDescription>
            This demo parses the same Documents three ways (AGENTIC, LAYOUT and OCR) and scores each against an answer key, so you can see what the cheaper parses miss.
            The Demo Agent answers questions across the results and can move the screen to the evidence. The tour takes about two minutes and costs nothing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close} data-testid="welcome-skip">Skip</Button>
          <Button
            onClick={() => {
              close()
              start()
            }}
            data-testid="welcome-tour"
          >
            Take the tour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

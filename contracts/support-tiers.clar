;; TrustOps Support Tiers Contract
;; Token-gated support access and STX-staked priority routing.
;;
;; Phase 2 - Automation & Token Gating:
;;   * Priority support based on STX holdings / stake
;;   * Smart-contract-enforced service tiers
;;   * Auto-refund when ticket is resolved

(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED    (err u401))
(define-constant ERR-INSUFFICIENT-STAKE (err u402))
(define-constant ERR-TICKET-NOT-FOUND  (err u404))
(define-constant ERR-ALREADY-STAKED   (err u409))

;; Minimum stake thresholds (uSTX; 1 STX = 1 000 000 uSTX)
(define-constant STAKE-PREMIUM    u1000000)   ;;  1 STX -> HIGH priority
(define-constant STAKE-ENTERPRISE u10000000)  ;; 10 STX -> CRITICAL priority

;; Priority levels
(define-constant PRIORITY-LOW      u1)
(define-constant PRIORITY-NORMAL   u2)
(define-constant PRIORITY-HIGH     u3)
(define-constant PRIORITY-CRITICAL u4)

;; Per-ticket stake record
(define-map ticket-stakes
  { ticket-id: uint }
  {
    staker:    principal,
    amount:    uint,
    priority:  uint,
    staked-at: uint
  }
)

;; -- Private helpers ---------------------------------------------------------

(define-private (calculate-priority (amount uint))
  (if (>= amount STAKE-ENTERPRISE)
    PRIORITY-CRITICAL
    (if (>= amount STAKE-PREMIUM)
      PRIORITY-HIGH
      (if (> amount u0)
        PRIORITY-NORMAL
        PRIORITY-LOW
      )
    )
  )
)

;; -- Public functions --------------------------------------------------------

;; Stake STX against a ticket to raise its service priority.
;; The caller must stake at least STAKE-PREMIUM uSTX.
;; Returns the resulting priority level.
(define-public (stake-for-priority (ticket-id uint) (amount uint))
  (begin
    (asserts! (is-none (map-get? ticket-stakes { ticket-id: ticket-id }))
              ERR-ALREADY-STAKED)
    (asserts! (>= amount STAKE-PREMIUM) ERR-INSUFFICIENT-STAKE)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set ticket-stakes
      { ticket-id: ticket-id }
      {
        staker:    tx-sender,
        amount:    amount,
        priority:  (calculate-priority amount),
        staked-at: block-height
      }
    )
    (ok (calculate-priority amount))
  )
)

;; Refund the staked amount to the original staker.
;; Callable by the staker themselves or the contract owner (on resolution).
(define-public (refund-stake (ticket-id uint))
  (let (
    (stake (unwrap! (map-get? ticket-stakes { ticket-id: ticket-id })
                    ERR-TICKET-NOT-FOUND))
  )
    (asserts!
      (or (is-eq tx-sender (get staker stake))
          (is-eq tx-sender CONTRACT-OWNER))
      ERR-NOT-AUTHORIZED)
    (try! (as-contract (stx-transfer? (get amount stake) tx-sender (get staker stake))))
    (map-delete ticket-stakes { ticket-id: ticket-id })
    (ok true)
  )
)

;; -- Read-only functions -----------------------------------------------------

(define-read-only (get-ticket-priority (ticket-id uint))
  (default-to PRIORITY-LOW
    (get priority (map-get? ticket-stakes { ticket-id: ticket-id }))
  )
)

(define-read-only (get-stake-info (ticket-id uint))
  (map-get? ticket-stakes { ticket-id: ticket-id })
)

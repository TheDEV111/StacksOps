;; TrustOps Reputation Contract
;; Wallet-based on-chain reputation derived from DAO participation,
;; dispute outcomes, and protocol activity.
;;
;; Phase 1 - Basic reputation scoring
;; Phase 3 - Dispute outcomes affect reputation

(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))

;; Reputation tier thresholds
(define-constant TIER-BRONZE   u1)   ;; 0 - 99 points
(define-constant TIER-SILVER   u2)   ;; 100 - 499 points
(define-constant TIER-GOLD     u3)   ;; 500 - 999 points
(define-constant TIER-PLATINUM u4)   ;; 1000+ points

;; Action types used by authorised callers
(define-constant ACTION-TICKET-RESOLVED  u1)  ;; +10 pts
(define-constant ACTION-DISPUTE-WON      u2)  ;; +25 pts
(define-constant ACTION-DISPUTE-LOST     u3)  ;; -15 pts
(define-constant ACTION-DAO-VOTE         u4)  ;; +5 pts
(define-constant ACTION-SPAM-PENALTY     u5)  ;; -20 pts

;; Default points awarded / deducted per action
(define-constant POINTS-TICKET-RESOLVED u10)
(define-constant POINTS-DISPUTE-WON     u25)
(define-constant POINTS-DISPUTE-LOST    u15)
(define-constant POINTS-DAO-VOTE        u5)
(define-constant POINTS-SPAM-PENALTY    u20)

;; Authorised contracts that may call update-reputation
(define-map authorized-contracts
  { contract: principal }
  { active: bool }
)

;; Per-wallet reputation record
(define-map reputation-scores
  { wallet: principal }
  {
    score:            uint,
    tier:             uint,
    tickets-resolved: uint,
    disputes-won:     uint,
    disputes-lost:    uint,
    last-updated:     uint
  }
)

;; -- Private helpers ---------------------------------------------------------

(define-private (ensure-reputation (wallet principal))
  (if (is-none (map-get? reputation-scores { wallet: wallet }))
    (map-set reputation-scores
      { wallet: wallet }
      {
        score:            u0,
        tier:             TIER-BRONZE,
        tickets-resolved: u0,
        disputes-won:     u0,
        disputes-lost:    u0,
        last-updated:     block-height
      }
    )
    true
  )
)

(define-private (calculate-tier (score uint))
  (if (>= score u1000)
    TIER-PLATINUM
    (if (>= score u500)
      TIER-GOLD
      (if (>= score u100)
        TIER-SILVER
        TIER-BRONZE
      )
    )
  )
)

;; Saturating subtraction - never underflows below zero
(define-private (safe-sub (a uint) (b uint))
  (if (>= a b) (- a b) u0)
)

;; -- Public functions --------------------------------------------------------

;; Allow the contract owner to register other TrustOps contracts as callers.
(define-public (authorize-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set authorized-contracts { contract: contract } { active: true })
    (ok true)
  )
)

;; Revoke an authorised contract.
(define-public (revoke-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set authorized-contracts { contract: contract } { active: false })
    (ok true)
  )
)

;; Update a wallet's reputation score based on a protocol action.
;; Callable by the contract owner or any authorised contract.
(define-public (update-reputation (wallet principal) (action uint) (points uint))
  (let (
    (is-auth
      (or (is-eq tx-sender CONTRACT-OWNER)
          (default-to false
            (get active (map-get? authorized-contracts { contract: tx-sender })))))
  )
    (asserts! is-auth ERR-NOT-AUTHORIZED)
    (ensure-reputation wallet)
    (let (
      (current (unwrap-panic (map-get? reputation-scores { wallet: wallet })))
      (old-score (get score current))
      (new-score
        (if (or (is-eq action ACTION-DISPUTE-LOST)
                (is-eq action ACTION-SPAM-PENALTY))
          (safe-sub old-score points)
          (+ old-score points)
        )
      )
      (new-tickets
        (if (is-eq action ACTION-TICKET-RESOLVED)
          (+ (get tickets-resolved current) u1)
          (get tickets-resolved current)
        )
      )
      (new-won
        (if (is-eq action ACTION-DISPUTE-WON)
          (+ (get disputes-won current) u1)
          (get disputes-won current)
        )
      )
      (new-lost
        (if (is-eq action ACTION-DISPUTE-LOST)
          (+ (get disputes-lost current) u1)
          (get disputes-lost current)
        )
      )
    )
      (map-set reputation-scores
        { wallet: wallet }
        {
          score:            new-score,
          tier:             (calculate-tier new-score),
          tickets-resolved: new-tickets,
          disputes-won:     new-won,
          disputes-lost:    new-lost,
          last-updated:     block-height
        }
      )
      (ok new-score)
    )
  )
)

;; -- Read-only functions -----------------------------------------------------

(define-read-only (get-reputation (wallet principal))
  (map-get? reputation-scores { wallet: wallet })
)

(define-read-only (get-score (wallet principal))
  (default-to u0 (get score (map-get? reputation-scores { wallet: wallet })))
)

(define-read-only (get-tier (wallet principal))
  (default-to TIER-BRONZE
    (get tier (map-get? reputation-scores { wallet: wallet }))
  )
)

(define-read-only (is-authorized-contract (contract principal))
  (default-to false
    (get active (map-get? authorized-contracts { contract: contract }))
  )
)

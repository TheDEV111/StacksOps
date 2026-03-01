;; TrustOps Core Contract
;; Manages support tickets and Bitcoin-anchored on-chain proofs.
;;
;; Phase 1 - Trust Foundations:
;;   * Wallet-linked ticket submission with content hash
;;   * On-chain proof anchoring (tamper-proof evidence)
;;   * Ticket lifecycle management (open -> in-progress -> resolved/disputed -> closed)

(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-TICKET-NOT-FOUND (err u404))
(define-constant ERR-INVALID-STATUS (err u400))

;; Ticket status constants
(define-constant STATUS-OPEN u1)
(define-constant STATUS-IN-PROGRESS u2)
(define-constant STATUS-RESOLVED u3)
(define-constant STATUS-DISPUTED u4)
(define-constant STATUS-CLOSED u5)

;; Auto-incrementing ticket counter
(define-data-var ticket-nonce uint u0)

;; Core ticket storage: indexed by ticket-id
(define-map support-tickets
  { ticket-id: uint }
  {
    submitter:       principal,
    content-hash:    (buff 32),  ;; SHA-256 of support interaction content
    status:          uint,
    created-at:      uint,       ;; Stacks block height at submission
    updated-at:      uint,
    resolution-hash: (optional (buff 32))
  }
)

;; On-chain proof anchors: one proof record per ticket
(define-map ticket-proofs
  { ticket-id: uint }
  {
    proof-hash:  (buff 32),  ;; Hash of the full evidence bundle
    anchored-at: uint,        ;; Bitcoin burn-block height at anchoring
    anchored-by: principal
  }
)

;; -- Public functions --------------------------------------------------------

;; Submit a new support ticket identified by the SHA-256 hash of its content.
;; Returns the new ticket-id.
(define-public (submit-ticket (content-hash (buff 32)))
  (let (
    (ticket-id (+ (var-get ticket-nonce) u1))
  )
    (var-set ticket-nonce ticket-id)
    (map-set support-tickets
      { ticket-id: ticket-id }
      {
        submitter:       tx-sender,
        content-hash:    content-hash,
        status:          STATUS-OPEN,
        created-at:      block-height,
        updated-at:      block-height,
        resolution-hash: none
      }
    )
    (ok ticket-id)
  )
)

;; Anchor a cryptographic proof for a ticket.
;; Only the original submitter may anchor proof for their own ticket.
(define-public (anchor-proof (ticket-id uint) (proof-hash (buff 32)))
  (let (
    (ticket (unwrap! (map-get? support-tickets { ticket-id: ticket-id })
                     ERR-TICKET-NOT-FOUND))
  )
    (asserts! (is-eq tx-sender (get submitter ticket)) ERR-NOT-AUTHORIZED)
    (map-set ticket-proofs
      { ticket-id: ticket-id }
      {
        proof-hash:  proof-hash,
        anchored-at: burn-block-height,
        anchored-by: tx-sender
      }
    )
    (ok true)
  )
)

;; Update ticket status.
;; Callable by the submitter or the contract owner (support agent).
(define-public (update-status (ticket-id uint) (new-status uint))
  (let (
    (ticket (unwrap! (map-get? support-tickets { ticket-id: ticket-id })
                     ERR-TICKET-NOT-FOUND))
  )
    (asserts!
      (or (is-eq tx-sender (get submitter ticket))
          (is-eq tx-sender CONTRACT-OWNER))
      ERR-NOT-AUTHORIZED)
    (asserts! (and (>= new-status u1) (<= new-status u5)) ERR-INVALID-STATUS)
    (map-set support-tickets
      { ticket-id: ticket-id }
      (merge ticket { status: new-status, updated-at: block-height })
    )
    (ok true)
  )
)

;; Resolve a ticket, storing the resolution hash.
;; Only the contract owner (support agent) may resolve tickets.
(define-public (resolve-ticket (ticket-id uint) (resolution-hash (buff 32)))
  (let (
    (ticket (unwrap! (map-get? support-tickets { ticket-id: ticket-id })
                     ERR-TICKET-NOT-FOUND))
  )
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set support-tickets
      { ticket-id: ticket-id }
      (merge ticket {
        status:          STATUS-RESOLVED,
        updated-at:      block-height,
        resolution-hash: (some resolution-hash)
      })
    )
    (ok true)
  )
)

;; -- Read-only functions -----------------------------------------------------

(define-read-only (get-ticket (ticket-id uint))
  (map-get? support-tickets { ticket-id: ticket-id })
)

(define-read-only (get-proof (ticket-id uint))
  (map-get? ticket-proofs { ticket-id: ticket-id })
)

(define-read-only (get-ticket-count)
  (var-get ticket-nonce)
)

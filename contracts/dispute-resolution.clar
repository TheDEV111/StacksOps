;; TrustOps Dispute Resolution Contract
;; Evidence submission, DAO arbitration, and on-chain rulings.
;;
;; Phase 3 - Dispute Resolution:
;;   * Any party may open a dispute linked to a support ticket
;;   * Both sides submit evidence hashes (tamper-proof)
;;   * Registered arbitrators vote during a fixed voting window
;;   * The majority ruling is recorded on-chain and triggers
;;     reputation updates for both parties

(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED   (err u401))
(define-constant ERR-DISPUTE-NOT-FOUND (err u404))
(define-constant ERR-ALREADY-EXISTS   (err u409))
(define-constant ERR-INVALID-STATE    (err u400))
(define-constant ERR-VOTING-CLOSED    (err u410))
(define-constant ERR-VOTING-OPEN      (err u411))

;; Dispute lifecycle statuses
(define-constant DISPUTE-OPEN                       u1)
(define-constant DISPUTE-VOTING                     u2)
(define-constant DISPUTE-RESOLVED-FAVOR-SUBMITTER   u3)
(define-constant DISPUTE-RESOLVED-FAVOR-RESPONDENT  u4)
(define-constant DISPUTE-DISMISSED                  u5)

;; Ruling identifiers (stored in the `ruling` field)
(define-constant RULING-SUBMITTER-WINS  u1)
(define-constant RULING-RESPONDENT-WINS u2)

;; Voting window: ~1 week at 10 min / Bitcoin block
(define-constant VOTING-PERIOD-BLOCKS u1008)

;; Auto-incrementing dispute counter
(define-data-var dispute-nonce uint u0)

;; Core dispute records
(define-map disputes
  { dispute-id: uint }
  {
    ticket-id:             uint,
    submitter:             principal,
    respondent:            principal,
    status:                uint,
    initial-evidence-hash: (buff 32),  ;; hash supplied at dispute creation
    created-at:            uint,
    voting-ends-at:        uint,
    votes-for-submitter:   uint,
    votes-for-respondent:  uint,
    ruling:                (optional uint)
  }
)

;; Additional evidence submissions (both parties may add items)
(define-map dispute-evidence
  { dispute-id: uint, index: uint }
  {
    submitted-by:  principal,
    evidence-hash: (buff 32),
    submitted-at:  uint
  }
)

;; Running count of evidence items per dispute
(define-map evidence-count
  { dispute-id: uint }
  { count: uint }
)

;; Vote registry - prevents double-voting
(define-map dispute-votes
  { dispute-id: uint, voter: principal }
  { vote: bool }  ;; true = favour submitter, false = favour respondent
)

;; Registered DAO arbitrators
(define-map arbitrators
  { arbitrator: principal }
  { active: bool }
)

;; -- Public functions --------------------------------------------------------

;; Open a new dispute referencing an existing support ticket.
;; The caller becomes the submitter; they must supply an initial evidence hash.
(define-public (submit-dispute
    (ticket-id      uint)
    (respondent     principal)
    (evidence-hash  (buff 32)))
  (let (
    (dispute-id   (+ (var-get dispute-nonce) u1))
    (voting-ends  (+ block-height VOTING-PERIOD-BLOCKS))
  )
    (var-set dispute-nonce dispute-id)
    (map-set disputes
      { dispute-id: dispute-id }
      {
        ticket-id:             ticket-id,
        submitter:             tx-sender,
        respondent:            respondent,
        status:                DISPUTE-OPEN,
        initial-evidence-hash: evidence-hash,
        created-at:            block-height,
        voting-ends-at:        voting-ends,
        votes-for-submitter:   u0,
        votes-for-respondent:  u0,
        ruling:                none
      }
    )
    (map-set evidence-count { dispute-id: dispute-id } { count: u0 })
    (ok dispute-id)
  )
)

;; Append an evidence item to an open dispute.
;; Either the submitter or the respondent may add evidence.
(define-public (add-evidence (dispute-id uint) (evidence-hash (buff 32)))
  (let (
    (dispute     (unwrap! (map-get? disputes { dispute-id: dispute-id })
                          ERR-DISPUTE-NOT-FOUND))
    (count-data  (default-to { count: u0 }
                   (map-get? evidence-count { dispute-id: dispute-id })))
    (idx         (get count count-data))
  )
    (asserts!
      (or (is-eq tx-sender (get submitter  dispute))
          (is-eq tx-sender (get respondent dispute)))
      ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status dispute) DISPUTE-OPEN) ERR-INVALID-STATE)
    (map-set dispute-evidence
      { dispute-id: dispute-id, index: idx }
      {
        submitted-by:  tx-sender,
        evidence-hash: evidence-hash,
        submitted-at:  block-height
      }
    )
    (map-set evidence-count { dispute-id: dispute-id } { count: (+ idx u1) })
    (ok (+ idx u1))
  )
)

;; Advance a dispute from OPEN -> VOTING.
;; Only the contract owner or a registered arbitrator may trigger this.
(define-public (start-voting (dispute-id uint))
  (let (
    (dispute          (unwrap! (map-get? disputes { dispute-id: dispute-id })
                               ERR-DISPUTE-NOT-FOUND))
    (caller-is-arb    (default-to false
                        (get active (map-get? arbitrators { arbitrator: tx-sender }))))
  )
    (asserts! (or (is-eq tx-sender CONTRACT-OWNER) caller-is-arb) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status dispute) DISPUTE-OPEN) ERR-INVALID-STATE)
    (map-set disputes
      { dispute-id: dispute-id }
      (merge dispute { status: DISPUTE-VOTING })
    )
    (ok true)
  )
)

;; Cast a vote on an active dispute.
;; Only registered arbitrators (or the contract owner) may vote.
;; Each address may vote only once per dispute.
(define-public (vote-on-dispute (dispute-id uint) (vote-for-submitter bool))
  (let (
    (dispute          (unwrap! (map-get? disputes { dispute-id: dispute-id })
                               ERR-DISPUTE-NOT-FOUND))
    (caller-is-arb    (default-to false
                        (get active (map-get? arbitrators { arbitrator: tx-sender }))))
  )
    (asserts! (or (is-eq tx-sender CONTRACT-OWNER) caller-is-arb) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status dispute) DISPUTE-VOTING) ERR-INVALID-STATE)
    (asserts! (<= block-height (get voting-ends-at dispute)) ERR-VOTING-CLOSED)
    (asserts! (is-none (map-get? dispute-votes { dispute-id: dispute-id, voter: tx-sender }))
              ERR-ALREADY-EXISTS)
    (map-set dispute-votes
      { dispute-id: dispute-id, voter: tx-sender }
      { vote: vote-for-submitter }
    )
    (map-set disputes
      { dispute-id: dispute-id }
      (merge dispute {
        votes-for-submitter:  (if vote-for-submitter
                                (+ (get votes-for-submitter  dispute) u1)
                                (get votes-for-submitter  dispute)),
        votes-for-respondent: (if (not vote-for-submitter)
                                (+ (get votes-for-respondent dispute) u1)
                                (get votes-for-respondent dispute))
      })
    )
    (ok true)
  )
)

;; Finalise the ruling after the voting window has closed.
;; The majority determines who wins; ties favour the respondent.
(define-public (finalize-ruling (dispute-id uint))
  (let (
    (dispute          (unwrap! (map-get? disputes { dispute-id: dispute-id })
                               ERR-DISPUTE-NOT-FOUND))
    (caller-is-arb    (default-to false
                        (get active (map-get? arbitrators { arbitrator: tx-sender }))))
  )
    (asserts! (or (is-eq tx-sender CONTRACT-OWNER) caller-is-arb) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status dispute) DISPUTE-VOTING) ERR-INVALID-STATE)
    (asserts! (> block-height (get voting-ends-at dispute)) ERR-VOTING-OPEN)
    (let (
      (submitter-wins
        (> (get votes-for-submitter dispute) (get votes-for-respondent dispute)))
      (final-status
        (if submitter-wins
          DISPUTE-RESOLVED-FAVOR-SUBMITTER
          DISPUTE-RESOLVED-FAVOR-RESPONDENT))
      (ruling-value
        (if submitter-wins RULING-SUBMITTER-WINS RULING-RESPONDENT-WINS))
    )
      (map-set disputes
        { dispute-id: dispute-id }
        (merge dispute {
          status: final-status,
          ruling: (some ruling-value)
        })
      )
      (ok final-status)
    )
  )
)

;; Register a DAO member as an arbitrator.
(define-public (add-arbitrator (arbitrator principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set arbitrators { arbitrator: arbitrator } { active: true })
    (ok true)
  )
)

;; Remove an arbitrator.
(define-public (remove-arbitrator (arbitrator principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set arbitrators { arbitrator: arbitrator } { active: false })
    (ok true)
  )
)

;; -- Read-only functions -----------------------------------------------------

(define-read-only (get-dispute (dispute-id uint))
  (map-get? disputes { dispute-id: dispute-id })
)

(define-read-only (get-evidence (dispute-id uint) (index uint))
  (map-get? dispute-evidence { dispute-id: dispute-id, index: index })
)

(define-read-only (get-evidence-count (dispute-id uint))
  (default-to u0
    (get count (map-get? evidence-count { dispute-id: dispute-id }))
  )
)

(define-read-only (get-vote (dispute-id uint) (voter principal))
  (map-get? dispute-votes { dispute-id: dispute-id, voter: voter })
)

(define-read-only (get-dispute-count)
  (var-get dispute-nonce)
)

(define-read-only (is-arbitrator (address principal))
  (default-to false
    (get active (map-get? arbitrators { arbitrator: address }))
  )
)

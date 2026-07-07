// backend/models/InterviewSlot.js

const mongoose = require('mongoose');

const interviewSlotSchema = new mongoose.Schema(
  {
    // ── Which Job this slot belongs to ──────────────────────────────────
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },

    // ── Which Company created this slot ─────────────────────────────────
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },

    // ── Slot Date & Time ─────────────────────────────────────────────────
    date: {
      type: Date,
      required: true,
    },

    startTime: {
      type: String, // "10:00 AM"
      required: true,
    },

    endTime: {
      type: String, // "11:30 AM"
      required: true,
    },

    // ── Capacity ─────────────────────────────────────────────────────────
    // Max candidates company can interview in this slot
    maxCandidates: {
      type: Number,
      required: true,
      min: 1,
    },
    
    // Average time per interview in minutes
    averageTime: {
      type: Number,
      default: 30,
    },

    // How many spots are still available
    // Decreases as partner assigns candidates
    availableSpots: {
      type: Number,
      required: true,
      min: 0,
    },

    // ── Candidates Booked in this slot ───────────────────────────────────
    bookedCandidates: [
      {
        candidate: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Candidate',
          required: true,
        },
        partner: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'StaffingPartner',
          required: true,
        },
        bookedAt: {
          type: Date,
          default: Date.now,
        },
        // Status of this specific booking
        bookingStatus: {
          type: String,
          enum: [
            'BOOKED',     // Partner assigned candidate to this slot
            'CANCELLED',  // Partner/Company cancelled
            'COMPLETED',  // Interview done
            'NO_SHOW',    // Candidate did not appear
          ],
          default: 'BOOKED',
        },
        cancelledAt: Date,
        cancelReason: String,
      },
    ],

    // ── Slot Status ───────────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'ACTIVE',     // Open for booking
        'FULL',       // maxCandidates reached
        'CANCELLED',  // Company cancelled this slot
        'COMPLETED',  // Interviews done
        'EXPIRED',    // Date passed without being used
      ],
      default: 'ACTIVE',
    },

    // ── Slot valid within job's date range ────────────────────────────────
    // date must be >= job submission date and <= job deadline
    // This is validated in controller

    // ── Notes by company ──────────────────────────────────────────────────
    notes: {
      type: String,
      default: null,
    },

    // Interview mode (Virtual, Face-to-Face, etc.)
    interviewMode: {
      type: String,
      enum: ['Virtual', 'Face-to-Face'],
      default: 'Virtual',
    },
    
    // Round scoping for Candidate Interview Pipeline
    roundType: {
      type: String,
      enum: ['ASSESSMENT', 'L1_INTERVIEW', 'L2_INTERVIEW', 'L3_INTERVIEW', 'HR_ROUND'],
      default: null,
    },

    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      default: null,
    },

    // Who created this slot (can be main company owner or sub-admin)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
interviewSlotSchema.index({ job: 1, date: 1 });
interviewSlotSchema.index({ job: 1, status: 1 });
interviewSlotSchema.index({ company: 1, date: 1 });
interviewSlotSchema.index({ 'bookedCandidates.candidate': 1 });
interviewSlotSchema.index({ 'bookedCandidates.partner': 1 });

// ── Virtual: is slot full ─────────────────────────────────────────────────────
interviewSlotSchema.virtual('isFull').get(function () {
  return this.availableSpots === 0;
});

// ── Virtual: active bookings count ───────────────────────────────────────────
interviewSlotSchema.virtual('activeBookingsCount').get(function () {
  return this.bookedCandidates.filter(
    (b) => b.bookingStatus === 'BOOKED'
  ).length;
});

module.exports = mongoose.model('InterviewSlot', interviewSlotSchema);
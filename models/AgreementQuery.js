// backend/models/AgreementQuery.js
const mongoose = require('mongoose');

const agreementQuerySchema = new mongoose.Schema({
    partner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StaffingPartner',
        required: true,
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Which clause/article they are asking about
    clauseReference: {
        type: String,
        required: true,
        trim: true
        // e.g. "Clause 9.1", "Article 5", "Schedule B"
    },

    // Their question
    query: {
        type: String,
        required: true,
        trim: true,
        minlength: [10, 'Query must be at least 10 characters'],
        maxlength: [2000, 'Query cannot exceed 2000 characters']
    },

    // Status of the query
    status: {
        type: String,
        enum: ['PENDING', 'RESPONDED', 'CLOSED'],
        default: 'PENDING',
        index: true
    },

    // Admin response
    response: {
        type: String,
        trim: true,
        maxlength: [3000, 'Response cannot exceed 3000 characters'],
        default: null
    },

    respondedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    respondedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

agreementQuerySchema.index({ partner: 1, status: 1, createdAt: -1 });
agreementQuerySchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('AgreementQuery', agreementQuerySchema);
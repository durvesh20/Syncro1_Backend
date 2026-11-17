// backend/models/CompanyUnit.js
const mongoose = require('mongoose');

const companyUnitSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Company reference is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Unit name is required'],
      trim: true,
      maxlength: [100, 'Unit name cannot exceed 100 characters'],
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [20, 'Unit code cannot exceed 20 characters'],
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    // Parent unit in hierarchy (null = Top-level unit directly under Company Admin)
    parentUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CompanyUnit',
      default: null,
      index: true,
    },
    // Materialized path for subtree querying (e.g. "/parentUnitId/unitId/")
    path: {
      type: String,
      default: '/',
      index: true,
    },
    // Depth level: 1 = Top-level unit, 2 = Sub-unit, 3 = Sub-sub-unit, etc.
    level: {
      type: Number,
      default: 1,
      min: 1,
    },
    // Designated Unit Head / Administrator
    head: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate unit names directly under the same parent within a company
companyUnitSchema.index({ company: 1, name: 1, parentUnit: 1 }, { unique: true });

// Pre-save hook to ensure path consistency
companyUnitSchema.pre('save', async function (next) {
  if (this.isModified('parentUnit') || this.isNew) {
    if (!this.parentUnit) {
      this.level = 1;
      this.path = `/${this._id}/`;
    } else {
      const parent = await mongoose.model('CompanyUnit').findById(this.parentUnit);
      if (parent) {
        this.level = (parent.level || 1) + 1;
        this.path = `${parent.path || `/${parent._id}/`}${this._id}/`;
      } else {
        this.level = 1;
        this.path = `/${this._id}/`;
      }
    }
  }
  next();
});

module.exports = mongoose.model('CompanyUnit', companyUnitSchema);

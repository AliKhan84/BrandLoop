/**
 * Feedback model — what a user tells us about the product.
 *
 * RESPONSIBILITY
 *   Store a message, who sent it, and where it was sent from, so the people
 *   building the next iteration can read it in context.
 *
 * WHY THE PAGE AND CATEGORY ARE STORED
 *   "The generate button did nothing" is unactionable without knowing which
 *   screen it was on. The category is what lets a hundred messages be grouped
 *   into the three things actually worth fixing.
 *
 * WHY STATUS IS A FIELD AND NOT A DELETION
 *   Reading feedback is a workflow: new, read, archived. Deleting would throw
 *   away the record that someone already answered a question, which is exactly
 *   what a second reader needs to know.
 *
 * DOES NOT OWN: who may read it (the admin routes) or how often a user may send
 * it (the `feedback` quota bucket).
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/** What kind of message this is. */
export const FEEDBACK_CATEGORY = Object.freeze({
  BUG: 'bug',
  IDEA: 'idea',
  PRAISE: 'praise',
  OTHER: 'other',
});

/** Where it is in the reading workflow. */
export const FEEDBACK_STATUS = Object.freeze({
  NEW: 'new',
  READ: 'read',
  ARCHIVED: 'archived',
});

const feedbackSchema = new Schema(
  {
    /** Who sent it. Anonymous feedback was considered and rejected: a reply has
     *  to be possible, and an unauthenticated endpoint is a spam magnet. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Copied from the account at submission time, so /me can be renamed later
     *  without losing the address this came from. */
    email: {
      type: String,
      trim: true,
      default: '',
    },

    category: {
      type: String,
      enum: Object.values(FEEDBACK_CATEGORY),
      default: FEEDBACK_CATEGORY.IDEA,
    },

    /** Optional 1–5. Null means "not rated", which is not the same as 0. */
    rating: {
      type: Number,
      default: null,
      min: 1,
      max: 5,
    },

    /** The message itself. 4000 characters is a long bug report and a short essay. */
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },

    /** The screen it was sent from, filled in by the form. */
    page: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: Object.values(FEEDBACK_STATUS),
      default: FEEDBACK_STATUS.NEW,
      index: true,
    },

    /** A note for the next reader, e.g. what was changed as a result. */
    adminNote: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/** The reading list is "newest first, filtered by status". */
feedbackSchema.index({ status: 1, createdAt: -1 });

/**
 * The shape both the sender and an administrator may see.
 *
 * @returns {object} Whitelisted fields.
 * @sideeffect none
 */
feedbackSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    userId: this.userId.toString(),
    email: this.email,
    category: this.category,
    rating: this.rating,
    message: this.message,
    page: this.page,
    status: this.status,
    adminNote: this.adminNote,
    createdAt: this.createdAt,
  };
};

export const Feedback = mongoose.model('Feedback', feedbackSchema);
export default Feedback;

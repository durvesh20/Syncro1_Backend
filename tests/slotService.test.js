/**
 * slotService.test.js
 * Unit tests for slot synchronization logic (1 vacancy = 5 slots rule).
 * Run: npx jest tests/slotService.test.js
 */

const { syncJobInterestSlots, ensureMinJobInterestSlots } = require('../services/slotService');
const JobInterest = require('../models/JobInterest');

// Mock JobInterest model
jest.mock('../models/JobInterest');

describe('slotService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncJobInterestSlots', () => {
    test('increases submissionLimit when vacancies increase (1 -> 2 vacancies => +5 slots)', async () => {
      const mockInterests = [
        {
          _id: 'interest1',
          submissionLimit: 5,
          submissionCount: 2,
          save: jest.fn().mockResolvedValue(true)
        },
        {
          _id: 'interest2',
          submissionLimit: 7, // manual extension (+2)
          submissionCount: 6,
          save: jest.fn().mockResolvedValue(true)
        }
      ];

      JobInterest.find.mockResolvedValue(mockInterests);

      await syncJobInterestSlots('job123', 1, 2);

      expect(JobInterest.find).toHaveBeenCalledWith({ job: 'job123' });
      expect(mockInterests[0].submissionLimit).toBe(10); // 5 + 5
      expect(mockInterests[0].save).toHaveBeenCalled();
      expect(mockInterests[1].submissionLimit).toBe(12); // 7 + 5
      expect(mockInterests[1].save).toHaveBeenCalled();
    });

    test('does nothing if oldVacancies equals newVacancies', async () => {
      await syncJobInterestSlots('job123', 2, 2);
      expect(JobInterest.find).not.toHaveBeenCalled();
    });

    test('does not reduce limit below submissionCount when vacancies decrease', async () => {
      const mockInterests = [
        {
          _id: 'interest1',
          submissionLimit: 10,
          submissionCount: 7,
          save: jest.fn().mockResolvedValue(true)
        }
      ];

      JobInterest.find.mockResolvedValue(mockInterests);

      // Decreasing vacancies 2 -> 1 (-5 slots delta). Base min is 5.
      // 10 - 5 = 5. But submissionCount is 7, so it caps at 7.
      await syncJobInterestSlots('job123', 2, 1);

      expect(mockInterests[0].submissionLimit).toBe(7);
      expect(mockInterests[0].save).toHaveBeenCalled();
    });
  });

  describe('ensureMinJobInterestSlots', () => {
    test('upgrades submissionLimit if below vacancies * 5', async () => {
      const interest = {
        submissionLimit: 5,
        submissionCount: 1,
        save: jest.fn().mockResolvedValue(true)
      };

      const job = { vacancies: 3 }; // Should require min 15 slots

      await ensureMinJobInterestSlots(interest, job);

      expect(interest.submissionLimit).toBe(15);
      expect(interest.save).toHaveBeenCalled();
    });

    test('keeps existing submissionLimit if already higher than vacancies * 5', async () => {
      const interest = {
        submissionLimit: 18,
        submissionCount: 2,
        save: jest.fn().mockResolvedValue(true)
      };

      const job = { vacancies: 3 }; // Min is 15

      await ensureMinJobInterestSlots(interest, job);

      expect(interest.submissionLimit).toBe(18);
      expect(interest.save).not.toHaveBeenCalled();
    });
  });
});

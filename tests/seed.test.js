import { connectTestDB, disconnectTestDB, clearTestDB } from './setup.js';
import { CATEGORIES, seedCategoriesDB } from '../scripts/seedCategories.js';
import ServiceCategory from '../model/serviceCategoryModel.js';
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe('seed:categories (the live-DB launch blocker)', () => {
  test('seeds the 5 live + 2 coming-soon categories and is idempotent', async () => {
    const first = await seedCategoriesDB();
    expect(first.created).toBe(CATEGORIES.length);
    expect(first.total).toBe(CATEGORIES.length);
    expect((await ServiceCategory.findOne({ name: 'Smartphones' })).isActive).toBe(true);
    expect((await ServiceCategory.findOne({ name: 'TVs' })).isActive).toBe(false);

    const again = await seedCategoriesDB();
    expect(again.created).toBe(0);
    expect(await ServiceCategory.countDocuments()).toBe(CATEGORIES.length);
  });
});
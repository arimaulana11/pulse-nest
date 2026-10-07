import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { Category }         from './category.entity.js';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  async findAll(userId: string, type?: string, q?: string) {
    const qb = this.repo.createQueryBuilder('cat')
      .where('(cat.user_id IS NULL OR cat.user_id = :userId)', { userId })
      .andWhere('cat.is_system = true OR cat.user_id = :userId', { userId })
      .orderBy('cat.sort_order', 'ASC');

    if (type === 'expense' || type === 'income') {
      qb.andWhere("(cat.type = :type OR cat.type = 'both')", { type });
    }

    if (q) {
      qb.andWhere('LOWER(cat.name) LIKE :q', { q: `%${q.toLowerCase()}%` });
    }

    const rows = await qb.getMany();
    return rows.map((c) => ({
      id:    c.id,
      label: c.name,
      emoji: c.emoji,
      color: c.color,
      type:  c.type,
    }));
  }
}

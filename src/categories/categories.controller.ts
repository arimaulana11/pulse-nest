import { Controller, Get, Query, Request } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service.js';

@ApiTags('Categories')
@ApiBearerAuth('access-token')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List kategori (sistem + milik user)',
    description: 'Mengembalikan semua kategori sistem dan kategori kustom milik user. Filter by type dan search by name.',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['expense', 'income'], description: 'Filter by tipe transaksi' })
  @ApiQuery({ name: 'q', required: false, description: 'Search nama kategori' })
  @ApiOkResponse({
    description: 'Array kategori',
    schema: {
      example: {
        categories: [
          { id: 'uuid', label: 'Makan & Minum', emoji: '🍳', color: '#B25329', type: 'expense' },
        ],
      },
    },
  })
  async findAll(
    @Request() req: { user: { id: string } },
    @Query('type') type?: string,
    @Query('q')    q?:    string,
  ) {
    const categories = await this.svc.findAll(req.user.id, type, q);
    return { categories };
  }
}

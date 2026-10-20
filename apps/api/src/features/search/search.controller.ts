import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SearchResponseSchema, toOpenApiSchema } from '@erp/contracts';
import type { SearchResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { Authenticated, CurrentAuth } from '../auth/decorators.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiCookieAuth()
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  /** Open to any signed-in user: only the kinds of record they may view are searched. */
  @Authenticated()
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(SearchResponseSchema) })
  find(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<SearchResponse> {
    return this.search.search(auth, query);
  }
}

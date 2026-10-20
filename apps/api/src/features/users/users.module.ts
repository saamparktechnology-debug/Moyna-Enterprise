import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({ controllers: [UsersController], providers: [UsersService, PasswordService] })
export class UsersModule {}

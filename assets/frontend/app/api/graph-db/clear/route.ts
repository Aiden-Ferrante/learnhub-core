//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { NextRequest, NextResponse } from 'next/server';
import { getGraphDbService, initializeGraphDb } from '@/lib/graph-db-util';
import { getGraphDbType } from '../../settings/route';
import { ArangoDBService } from '@/lib/arangodb';
import { Neo4jService } from '@/lib/neo4j';
import { getUserDbName } from '@/lib/user-db';

/**
 * POST handler for clearing all data from the graph database
 */
export async function POST(request: NextRequest) {
  try {
    // Get the preferred database type from settings
    const graphDbType = getGraphDbType();
    console.log(`Using graph database for clearing: ${graphDbType}`);

    // Resolve the per-user database from the session
    const userDbName = await getUserDbName();

    // Get the appropriate service
    const graphDbService = getGraphDbService(graphDbType, userDbName);

    // Ensure the connection is initialized — this route may be the first DB call
    // in a fresh server process, where the instance hasn't connected yet.
    if (!graphDbService.isInitialized()) {
      await initializeGraphDb(graphDbType, userDbName);
    }

    // Clear the database based on type
    if (graphDbType === 'arangodb') {
      const arangoService = graphDbService as ArangoDBService;
      await arangoService.clearDatabase();
    } else if (graphDbType === 'neo4j') {
      // Neo4j clear is not implemented; report it cleanly instead of a 500.
      return NextResponse.json(
        { error: 'Clear database is not implemented for Neo4j' },
        { status: 501 }
      );
    }
    
    // Return success response
    return NextResponse.json({
      success: true,
      message: `Successfully cleared all data from ${graphDbType} database`,
      databaseType: graphDbType
    });
  } catch (error) {
    console.error(`Error in clear database handler:`, error);
    return NextResponse.json(
      { error: `Failed to clear database: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
} 